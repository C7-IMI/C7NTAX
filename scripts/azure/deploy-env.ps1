<#
.SYNOPSIS
    Builds the C7NTAX image, applies infrastructure, migrates the database and shifts
    traffic to the new revision for one environment (PLAN-016).

.DESCRIPTION
    One command per environment, safe to re-run. The order exists so that a failure never
    leaves the environment serving a revision whose schema was not applied:

      1. preflight            repository, guards, migrations, environment contract
      2. infrastructure       az deployment group create (Bicep); the template is given the image
                              the app is *already* running, so it cannot move it. An environment's
                              first run makes it in two passes - see THE FIRST RUN below
      3. image                docker build + push to ACR (or az acr build)
      4. migration job        same image, overridden command: prisma migrate deploy
      5. revision             new Container App revision, 0% traffic
      6. health gate          /api/health and an authenticated call on the new revision
      7. traffic shift        move 100% traffic, then re-check
      8. report               environment URL, revision name, rollback command

    If the health gate fails, traffic is never shifted and the previous revision keeps
    serving; the script prints the exact command to roll back the image.

    THE PROMOTION PATH (PLAN-016 §1). Work happens on dev, and production receives what dev
    has already proved:

        1. sync to GitHub   work lands on main (commit + push)
        2. push to dev      this script with -Environment dev (or the push-to-main workflow,
                            which does the same thing)
        3. push to prod     this script with -Environment prod -PromoteFrom dev — or the
                            "Deploy to Azure" workflow dispatched with environment=prod,
                            behind the `prod` GitHub environment's reviewers

    -PromoteFrom dev is what makes step 3 a promotion rather than a second build: the tag is
    read back from the running dev app, so the artifact production runs is byte-for-byte the
    one dev verified. Nothing is rebuilt, and no commit that dev has not run can reach prod.

    The Bicep step never decides which image runs, and never moves traffic (PLAN-030 1.3, review 5).
    On an ordinary run it is given the image the app is already serving and the revision that is
    serving 100% of traffic, which the template restates in its ingress traffic rule. Applying
    infrastructure therefore cannot promote anything: only the revision step below, after the health
    gate, moves the image and the traffic.

    THE FIRST RUN (PLAN-030 review 4, option (b)). On an environment where nothing of ours is running
    yet - no app, or an app still on the placeholder image - the container app is created *once,
    against the real image*, so it is never created against a port the application does not listen
    on:

        1. pass 1 - everything except the app is deployed (createApp=false): the registry above all,
           then the database, the vault, the Container Apps environment and the app's identity;
        2. the Registry and Image steps below build and push the real image into that registry;
        3. pass 2 - the app itself is deployed (createApp=true), against the tag just built, with no
           activeRevision because nothing is serving yet.

    The reason the app cannot simply be created first is the defect review 4 records: a probe's
    `port` is a required field of the container *revision template*, not part of the ingress, so
    `az containerapp update --target-port` moves the ingress and leaves the probes where the last
    deployment declared them. An app created against the placeholder image therefore keeps probing
    the placeholder's port after the real image is installed, its revision goes Unhealthy, and the
    health gate below stops the run. From pass 2 onwards - and on every later run, where the single
    pass above is unchanged - the flow is followed by the same revision, gate and traffic steps, so
    a first run exercises the same promotion path a redeploy does.

.PARAMETER Environment
    dev or prod. dev is deployed automatically by CI; prod only on an explicit push.

.PARAMETER ImageTag
    Image tag to deploy. Defaults to the short git commit sha, so a deploy is traceable to
    a commit and the same tag can be used for dev and prod. A tag that already exists in the
    registry and does not match HEAD is never overwritten: the script stops and asks for
    -SkipBuild, because rebuilding it would change what that tag refers to.

.PARAMETER SkipBuild
    Do not build an image — deploy one that already exists in the registry. Implied by
    -PromoteFrom, and required to re-deploy or roll back to an existing tag.

.PARAMETER PromoteFrom
    Take the image tag from what this environment is *already running* instead of building a
    new one — `-PromoteFrom dev` when pushing to production. Implies -SkipBuild. The image is
    copied from that environment's registry into this one (each environment has its own), so
    production still runs the exact digest dev verified.

.PARAMETER Create
    Create the resource group when it does not exist. Bicep creates everything inside it
    (registry, PostgreSQL, Container Apps environment and app, Key Vault); the group itself
    is the one thing it cannot create. Use it for the first deployment of an environment —
    `-Create` on dev, then `-Create` on prod — and never afterwards.

.PARAMETER Yes
    Answer yes to the production confirmation. Required for a hand-run against prod; the
    pipeline sets CI=true, which is treated as an already-deliberate action.

.PARAMETER ResourceGroup
    Resource group to deploy into. Defaults to rg-c7ntax-<environment>.

.PARAMETER SkipInfrastructure
    Skip the Bicep deployment (image and application only).

.PARAMETER SkipMigrations
    Skip the migration job. Only valid when the schema is already known to be current.

.PARAMETER WhatIf
    Print every command that would run without changing anything.

.EXAMPLE
    # First time, per environment: create it (secrets exported for this shell).
    ./scripts/azure/deploy-env.ps1 -Environment dev  -Create
    ./scripts/azure/deploy-env.ps1 -Environment prod -Create

    # The everyday loop: dev from the working tree, then promote the same tag to prod.
    ./scripts/azure/deploy-env.ps1 -Environment dev
    ./scripts/azure/deploy-env.ps1 -Environment prod -PromoteFrom dev -Yes

.EXAMPLE
    ./scripts/azure/deploy-env.ps1 -Environment prod -WhatIf
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('dev', 'prod')][string]$Environment,
    [string]$ImageTag = '',
    [ValidateSet('dev', 'prod')][string]$PromoteFrom = '',
    [switch]$Create,
    [switch]$Yes,
    [string]$ResourceGroup = '',
    [string]$Registry = '',
    [switch]$SkipInfrastructure,
    [switch]$SkipMigrations,
    [switch]$SkipBuild,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$appName = "c7ntax-$Environment"
if (-not $ResourceGroup) { $ResourceGroup = "rg-c7ntax-$Environment" }
# CI has already been through the environment's approval gate, so the confirmation below is
# for a human at a keyboard and not for the pipeline.
$inCi = [bool]$env:CI
$location = if ($env:AZURE_LOCATION) { $env:AZURE_LOCATION } else { 'eastus2' }
$sourceRegistry = ''
$sourceImageTag = ''
if ($PromoteFrom) { $SkipBuild = $true }

# The .bicepparam files read the secrets out of the environment (PLAN-030 §2.2), so a deployment
# that is missing one fails while it is being compiled instead of writing an empty signing key into
# Key Vault. The names below are the ones they read; PG_ADMIN_PASSWORD is still accepted as the
# alias an existing shell has exported.
$postgresPassword = [System.Environment]::GetEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
if (-not $postgresPassword) { $postgresPassword = [System.Environment]::GetEnvironmentVariable('PG_ADMIN_PASSWORD') }
# The image the Bicep step is given: the one the app is already running, so applying infrastructure
# cannot move it (PLAN-030 1.3). Replaced below, once the Azure context is known, with the real
# value; this is the answer for a dry run, and for a first run. On a first run it is required
# whatever happens, because the template's imageTag parameter has no default - but pass 1 creates no
# app, so nothing consumes it there. The app is created in pass 2 with the image the Image step just
# built (PLAN-030 review 4, option (b)).
$bicepImage = 'mcr.microsoft.com/k8se/quickstart:latest'
# The revision serving 100% of traffic, read before the revision step creates a newer one and passed
# to the Bicep step, whose ingress traffic rule restates it (review §5). Empty means nothing is
# serving yet — the first run of an environment.
$activeRevision = ''
# Set by the Infrastructure step when this is an environment's first run: the app is then created in
# a second pass, after the image exists (PLAN-030 review 4, option (b)).
$createAppAfterImage = $false

# The promotion path, printed the way the operator said it: sync, dev, prod. Seeing which step
# this run is makes "did I push that to production or only to dev?" a question the output answers.
Write-Host "`nC7NTAX deploy — $Environment" -ForegroundColor White
Write-Host '  sync to GitHub -> push to dev -> push to production' -ForegroundColor DarkGray
if ($PromoteFrom) {
    Write-Host "  this run: push to $Environment, promoting the tag $PromoteFrom is running" -ForegroundColor DarkGray
} elseif ($Environment -eq 'dev') {
    Write-Host '  this run: push to dev' -ForegroundColor DarkGray
} else {
    Write-Host '  this run: push to production' -ForegroundColor DarkGray
}

if ($Environment -eq 'prod' -and -not $Yes -and -not $inCi -and -not $WhatIf) {
    # Prod is a deliberate action by design (PLAN-016 §1 step 3). The pipeline gets this from the
    # `prod` GitHub environment's required reviewers; a human gets it from this question.
    $answer = Read-Host "Push to PRODUCTION (rg-c7ntax-prod)? Type 'prod' to continue"
    if ($answer -ne 'prod') { throw 'Production deploy cancelled. Nothing was changed.' }
}

if (-not $ImageTag -and -not $PromoteFrom) {
    $ImageTag = (git -C $repoRoot rev-parse --short HEAD 2>$null)
    if (-not $ImageTag) { throw 'Could not derive an image tag from git; pass -ImageTag explicitly.' }
}

function Write-Step([string]$Message) { Write-Host "`n=== $Message" -ForegroundColor Cyan }
function Write-Info([string]$Message) { Write-Host "    $Message" -ForegroundColor Gray }
function Invoke-Az([string[]]$Arguments) {
    if ($WhatIf) { Write-Info "would run: az $($Arguments -join ' ')"; return $null }
    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) { throw "az $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    return $output
}

Write-Step "Preflight ($Environment, tag $ImageTag)"
if ($WhatIf) { Write-Info 'would run: node scripts/azure/preflight.mjs' }
else {
    & node (Join-Path $repoRoot 'scripts\azure\preflight.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Preflight failed — fix the reported items before deploying.' }
}

# Secrets come from the environment of the deploying shell (or the pipeline's secret store)
# and are written straight into Key Vault by the Bicep deployment — never into a file. The names
# are the ones infra/params/<env>.bicepparam reads, so the parameter file compiles as well.
if (-not $SkipInfrastructure -and -not $WhatIf) {
    $missing = @()
    if (-not $postgresPassword) { $missing += 'POSTGRES_ADMIN_PASSWORD (or PG_ADMIN_PASSWORD)' }
    foreach ($required in @('JWT_SECRET_VALUE', 'KUMO_MASTER_KEY_VALUE')) {
        if (-not [System.Environment]::GetEnvironmentVariable($required)) { $missing += $required }
    }
    if ($missing.Count) {
        throw "Environment variable(s) $($missing -join ', ') not set. Export them for this shell (or set them as pipeline secrets) and re-run; secrets are never read from a file in the repository."
    }
    $env:POSTGRES_ADMIN_PASSWORD = $postgresPassword
}

Write-Step 'Azure context'
$azAvailable = [bool](Get-Command az -ErrorAction SilentlyContinue)
if (-not $azAvailable) {
    if (-not $WhatIf) { throw 'Azure CLI (az) is not installed. Install it (https://aka.ms/azure-cli) or run with -WhatIf to preview the plan.' }
    Write-Info 'az is not installed: showing the plan with placeholder values'
}
    if ($WhatIf -and $Create) {
        # The one action a first run takes that a later run must not, so the dry run says it
        # whether or not the CLI is installed.
        Write-Info "would create the resource group $ResourceGroup in $location if it does not exist"
    }
if ($azAvailable) {
    $account = Invoke-Az @('account', 'show', '--query', 'name', '-o', 'tsv')
    if ($account) { Write-Info "subscription: $account" }
    if (-not $WhatIf) {
        $rgExists = (& az group exists --name $ResourceGroup)
        if ($rgExists -ne 'true') {
            # The resource group is the one thing Bicep cannot create - it is the thing a
            # deployment is scoped *to*. So creating an environment is `-Create` once, and
            # everything inside it (registry, PostgreSQL, Container Apps environment and app,
            # Key Vault, the role assignments) comes from the template in the same run.
            # There are two of these to make: dev and prod, each with its own group.
            if (-not $Create) {
                throw "Resource group $ResourceGroup does not exist. Run with -Create to create it (the first deployment of an environment), or pass -ResourceGroup for a different one."
            }
            Write-Step "Creating resource group $ResourceGroup"
            Invoke-Az @('group', 'create', '--name', $ResourceGroup, '--location', $location, '--tags', 'project=c7ntax', "environment=$Environment") | Out-Null
            Write-Info "created $ResourceGroup in $location"
        }
    }
}

if ($PromoteFrom) {
    # Promotion reads the tag back from the environment that already proved it, so production
    # cannot receive a commit dev has not run — and nothing is built a second time.
    Write-Step "Promotion source ($PromoteFrom)"
    $sourceApp = "c7ntax-$PromoteFrom"
    $sourceRg = "rg-c7ntax-$PromoteFrom"
    if ($WhatIf) {
        Write-Info "would read the image tag running on $sourceApp in $sourceRg"
        if (-not $ImageTag) { $ImageTag = '<tag-from-dev>' }
        $sourceRegistry = '<source-registry>'
    } else {
        $sourceImage = (& az containerapp show --name $sourceApp --resource-group $sourceRg --query "properties.template.containers[0].image" -o tsv 2>$null)
        if (-not $sourceImage) { throw "Could not read the running image for $sourceApp in $sourceRg. Deploy $PromoteFrom first — production only receives what dev has verified." }
        $sourceTag = ($sourceImage -split ':')[-1]
        $sourceRegistry = (& az acr list --resource-group $sourceRg --query "[0].name" -o tsv 2>$null)
        if (-not $sourceRegistry) { throw "No container registry found in $sourceRg; cannot promote from $PromoteFrom." }
        Write-Info "$sourceApp is running $sourceTag, from registry $sourceRegistry"
        # An explicit -ImageTag wins, because somebody asking for a particular tag has a reason;
        # it is reported rather than silently obeyed.
        if ($ImageTag -and $ImageTag -ne $sourceTag) {
            Write-Info "note: -ImageTag $ImageTag overrides the tag $PromoteFrom is running ($sourceTag)"
        } else {
            $ImageTag = $sourceTag
        }
    }
}

if (-not $SkipInfrastructure) {
    Write-Step 'Infrastructure (Bicep)'

    # Bicep must not own the running image (PLAN-030 1.3). The template is given the image the app is
    # already serving, so applying infrastructure restates the live revision rather than pointing it
    # at a tag that does not exist yet - the build below, and the update after it, are still the only
    # things that move the image.
    #
    # Reading the running image is also how the first run is recognised: no app, or one still on the
    # placeholder image, means nothing of ours is serving in this environment. That is the run that
    # must create the app only once the real image exists (PLAN-030 review 4, option (b)), so it
    # takes two passes.
    $firstRun = $false
    if ($WhatIf) {
        Write-Info "would pass the image $appName is running as the Bicep imageTag (or $bicepImage when nothing is running yet)"
        # Nothing is inspected under -WhatIf, so the dry run describes the first-run shape, which is
        # the one with two passes. A redeploy is the single pass in the else branch below.
        Write-Info 'would make two passes if nothing of ours is running yet (createApp=false, then createApp=true once the image exists); one pass otherwise'
        $firstRun = $true
    } elseif ($azAvailable) {
        $runningImage = (& az containerapp show --name $appName --resource-group $ResourceGroup --query "properties.template.containers[0].image" -o tsv 2>$null)
        if ($runningImage -and $runningImage -notlike 'mcr.microsoft.com/*') {
            $bicepImage = ($runningImage -split ':')[-1]
            Write-Info "the app is running $runningImage; Bicep gets imageTag=$bicepImage and does not move it"
        } else {
            $firstRun = $true
            Write-Info 'nothing of ours is running yet: everything except the app is created first, then the app with the image built below'
        }
    }

    # Which revision is serving is read *here*, before the revision step below creates a newer one,
    # because after that update this query would return the new revision — the one whose health has
    # not been looked at yet (review §5). The template restates this revision in its ingress
    # traffic rule, so a Bicep run cannot hand 100% of the traffic to a revision that failed the
    # health gate. Empty is correct on the first run: there is nothing to restate.
    if ($WhatIf) {
        Write-Info 'would read the revision serving 100% of traffic and pass it as activeRevision'
    } elseif ($azAvailable) {
        # Single-quoted so the backticks in the JMESPath literal survive to the CLI unchanged.
        $activeRevision = (& az containerapp revision list --name $appName --resource-group $ResourceGroup --query '[?properties.trafficWeight==`100`].name | [0]' -o tsv 2>$null)
        if ($activeRevision) {
            Write-Info "the app is serving $activeRevision; Bicep restates it and cannot move traffic"
        } else {
            Write-Info 'nothing is serving yet; the app starts on its first revision'
        }
    }

    # Exported as well as passed, because the parameter file reads IMAGE_TAG out of the environment
    # the same way it reads the secrets.
    $env:IMAGE_TAG = $bicepImage

    $paramsFile = Join-Path $repoRoot "infra\params\$Environment.bicepparam"
    # imageTag and createApp are added by each pass below: imageTag has no default, so pass 1 must
    # still be given the placeholder (no resource consumes it while createApp=false), and pass 2 is
    # given the tag the Image step builds.
    $bicepParameters = @(
        '--parameters', $paramsFile,
        '--parameters', "postgresAdminPassword=$postgresPassword",
        "jwtSecret=$([System.Environment]::GetEnvironmentVariable('JWT_SECRET_VALUE'))",
        "kumoMasterKey=$([System.Environment]::GetEnvironmentVariable('KUMO_MASTER_KEY_VALUE'))"
    )
    # Only when there is one: an empty value is what the template's own default already provides,
    # and the parameter is not set in the .bicepparam files (it is this script's to pass).
    if ($activeRevision) { $bicepParameters += @('--parameters', "activeRevision=$activeRevision") }

    $bicepTemplate = Join-Path $repoRoot 'infra\main.bicep'
    # A first run creates the app in the second pass below, once the Image step has built the image;
    # every other run creates nothing and stays the single pass in the else branch.
    $createAppAfterImage = $firstRun
    if ($firstRun) {
        # Pass 1 of a first run: everything except the app (PLAN-030 review 4, option (b)). The
        # registry is the resource this pass most has to create, because the Image step below builds
        # into it. createApp=false means the app is not created here, so the placeholder imageTag
        # passed for completeness is not consumed by anything.
        # This depends on the default incremental deployment mode (no --mode is passed): a
        # Complete-mode deployment with createApp=false would *delete* the app.
        Invoke-Az (@('deployment', 'group', 'what-if',
            '--resource-group', $ResourceGroup,
            '--template-file', $bicepTemplate) + $bicepParameters +
            @('--parameters', "imageTag=$bicepImage", '--parameters', 'createApp=false')) | Out-Null
        if (-not $WhatIf) {
            Write-Info 'what-if reviewed; applying everything except the app (set -WhatIf to only preview)'
        }
        Invoke-Az (@('deployment', 'group', 'create',
            '--resource-group', $ResourceGroup,
            '--template-file', $bicepTemplate) + $bicepParameters +
            @('--parameters', "imageTag=$bicepImage", '--parameters', 'createApp=false')) | Out-Null
    } else {
        # An ordinary redeploy: the single pass it has always been. Nothing here creates the app; it
        # restates the running image and the serving revision, so it cannot move either.
        Invoke-Az (@('deployment', 'group', 'what-if',
            '--resource-group', $ResourceGroup,
            '--template-file', $bicepTemplate) + $bicepParameters +
            @('--parameters', "imageTag=$bicepImage")) | Out-Null
        if (-not $WhatIf) {
            Write-Info 'what-if reviewed; applying (set -WhatIf to only preview)'
        }
        Invoke-Az (@('deployment', 'group', 'create',
            '--resource-group', $ResourceGroup,
            '--template-file', $bicepTemplate) + $bicepParameters +
            @('--parameters', "imageTag=$bicepImage")) | Out-Null
    }
}

Write-Step 'Registry'
# Resolved after the infrastructure step, because on the first run of an environment the
# registry is one of the things the Bicep deployment creates. Each environment has its own,
# so an app only ever pulls from a registry its own identity has AcrPull on.
if (-not $Registry) {
    if ($WhatIf) {
        # Nothing is inspected under -WhatIf: the CLI may not even be installed, and that is
        # the point of a dry run.
        $Registry = '<registry>'
    } elseif ($azAvailable) {
        $Registry = (& az acr list --resource-group $ResourceGroup --query "[0].name" -o tsv 2>$null)
        if (-not $Registry) { throw "No container registry found in $ResourceGroup; pass -Registry." }
    }
}
Write-Info "registry: $Registry"

Write-Step 'Image'
$image = "$Registry.azurecr.io/c7ntax:$ImageTag"
if ($SkipBuild) {
    # Promotion and re-deploys must not rebuild: a second build of the same commit is a
    # *different* image, which would quietly break the guarantee that prod runs what dev ran.
    if ($PromoteFrom -and $sourceRegistry -and $sourceRegistry -ne $Registry) {
        # The two environments have their own registries and an app can only pull the registry
        # its identity holds AcrPull on, so the artifact is copied rather than referenced.
        # acr import moves the manifest and its layers by digest: still byte-for-byte the
        # artifact dev verified, and prod stops depending on dev's registry staying put.
        Write-Info "importing $ImageTag from $sourceRegistry into $Registry"
        Invoke-Az @('acr', 'import', '--name', $Registry,
            '--source', "$sourceRegistry.azurecr.io/c7ntax:$ImageTag",
            '--image', "c7ntax:$ImageTag") | Out-Null
    }
    Write-Info "using the existing image $image (no build)"
    if (-not $WhatIf) {
        $exists = (& az acr repository show-tags --name $Registry --repository c7ntax --query "[?@=='$ImageTag'] | [0]" -o tsv 2>$null)
        if (-not $exists) {
            $hint = if ($PromoteFrom) { "Deploy that tag to $PromoteFrom first, or pass an -ImageTag that exists." } else { 'Drop -SkipBuild to build it, or pass an -ImageTag that exists.' }
            throw "Image c7ntax:$ImageTag is not in $Registry. $hint"
        }
    }
} else {
    if (-not $WhatIf -and $azAvailable) {
        # Overwriting a tag that already names a different commit destroys the meaning of the
        # tag — prod would be running something other than what dev verified under that name.
        # Building the current commit is what a build is for, so that case is allowed; anything
        # else is a rollback or a re-deploy that forgot -SkipBuild.
        $existing = (& az acr repository show-tags --name $Registry --repository c7ntax --query "[?@=='$ImageTag'] | [0]" -o tsv 2>$null)
        if ($existing -and $ImageTag -ne (git -C $repoRoot rev-parse --short HEAD 2>$null)) {
            throw "c7ntax:$ImageTag already exists in $Registry and does not match HEAD. Pass -SkipBuild to deploy that existing image, or choose a tag that does not exist yet."
        }
    }
    Invoke-Az @('acr', 'build', '--registry', $Registry, '--image', "c7ntax:$ImageTag", $repoRoot) | Out-Null
    Write-Info "built and pushed $image"
}

# Pass 2 of a first run (PLAN-030 review 4, option (b)): the app is created here, against the image
# the Image step has just built and pushed into the registry pass 1 created. That is the whole point
# of splitting the deployment - the app is only ever created on port 4000 with its probes on 4000, so
# the port hand-off that made the old first run fail cannot happen. No activeRevision is passed:
# nothing is serving yet, so the ingress traffic rule starts on the app's own first revision. From
# here the run continues through the same migration, revision, health-gate and traffic steps every
# later deployment uses. It sits before the migration step because the migration job is created from
# the app's identity, which the script reads off the app itself.
if ($createAppAfterImage) {
    Write-Step 'Infrastructure (Bicep, create the app)'
    $env:IMAGE_TAG = $ImageTag
    Invoke-Az (@('deployment', 'group', 'create',
        '--resource-group', $ResourceGroup,
        '--template-file', (Join-Path $repoRoot 'infra\main.bicep')) + $bicepParameters +
        @('--parameters', "imageTag=$ImageTag", '--parameters', 'createApp=true')) | Out-Null
    if (-not $WhatIf) { Write-Info "created $appName against $image" }
}

if (-not $SkipMigrations) {
    Write-Step 'Database migration'
    # A one-shot job from the same image, so the schema moves with the exact code that expects it.
    # --command overrides the app's CMD. The job stays this script's to own: declaring it in the
    # Bicep is a larger change than PLAN-030 §1.8, and it is reviewed separately.
    $jobName = "$appName-migrate"
    $rg = $ResourceGroup

    # The job pulls its image and reads DATABASE_URL as the *user-assigned* identity the Bicep
    # deployment attached to the app (PLAN-030 §1.8). --mi-system-assigned used to give the job an
    # identity of its own, which holds neither AcrPull nor Key Vault Secrets User, so the pull
    # failed on the first run of an environment.
    $jobIdentity = ''
    $vaultUri = ''
    if ($WhatIf) {
        $jobIdentity = '<user-assigned-identity-resource-id>'
        $vaultUri = '<key-vault-uri>/'
        Write-Info 'would read the app''s user-assigned identity and the vault URI from Azure'
    } else {
        # keys(@) rather than ConvertFrom-Json: the property is absent on an app with only a
        # system-assigned identity, and reading it back as JSON throws under Set-StrictMode.
        $jobIdentity = @(& az containerapp show --name $appName --resource-group $rg --query "identity.userAssignedIdentities | keys(@)" -o tsv 2>$null) |
            Where-Object { $_ } | Select-Object -First 1
        if (-not $jobIdentity) {
            throw "$appName has no user-assigned identity, so a migration job cannot pull its image or read DATABASE_URL. Run the infrastructure step (drop -SkipInfrastructure) first."
        }
        $vaultName = (& az keyvault list --resource-group $rg --query "[0].name" -o tsv 2>$null)
        if ($vaultName) { $vaultUri = (& az keyvault show --name $vaultName --query "properties.vaultUri" -o tsv 2>$null) }
        if (-not $vaultUri) { throw "Could not find a Key Vault in $rg to read DATABASE-URL from; the migration job needs it." }
        Write-Info "job identity: $jobIdentity"
    }

    # Idempotent (PLAN-030 §1.8): create the job the first time, otherwise move its image. A second
    # run used to re-create it, and `job start` on a job that does not exist fails.
    $jobExists = ''
    if (-not $WhatIf) {
        $jobExists = (& az containerapp job show --name $jobName --resource-group $rg --query "name" -o tsv 2>$null)
    }
    if ($jobExists) {
        Invoke-Az @('containerapp', 'job', 'update',
            '--name', $jobName, '--resource-group', $rg,
            '--image', $image,
            '--mi-user-assigned', $jobIdentity, '--registry-identity', $jobIdentity) | Out-Null
        Write-Info "updated $jobName to $image"
    } else {
        Invoke-Az @('containerapp', 'job', 'create',
            '--name', $jobName, '--resource-group', $rg, '--environment', "aca-$appName",
            '--image', $image, '--command', 'npx prisma migrate deploy',
            '--cpu', '0.5', '--memory', '1.0Gi', '--replica-timeout', '900', '--replica-retry-limit', '1',
            '--registry-server', "$Registry.azurecr.io",
            '--mi-user-assigned', $jobIdentity, '--registry-identity', $jobIdentity,
            '--secrets', "database-url=keyvaultref:${vaultUri}secrets/DATABASE-URL,identityref:$jobIdentity",
            '--env-vars', 'DATABASE_URL=secretref:database-url') | Out-Null
        Write-Info "created $jobName"
    }
    Invoke-Az @('containerapp', 'job', 'start', '--name', $jobName, '--resource-group', $rg) | Out-Null
    if (-not $WhatIf) {
        Write-Info 'waiting for the migration job…'
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 10
            $state = (& az containerapp job execution list --name $jobName --resource-group $rg --query "[0].properties.status" -o tsv 2>$null)
            if ($state -in @('Succeeded', 'Failed')) { break }
        }
        if ($state -ne 'Succeeded') { throw "Migration job ended as '$state' — the previous revision keeps serving. Inspect: az containerapp job execution list --name $jobName --resource-group $rg" }
        Write-Info 'migration applied'
    }
}

Write-Step 'Revision'
$revisionSuffix = "$Environment-$ImageTag".ToLowerInvariant() -replace '[^a-z0-9-]', '-'
# Multiple mode *first* (PLAN-030 §1.3). In Single mode the update below would replace the serving
# revision on the spot, and the health gate further down would be inspecting a revision that was
# already taking traffic. The template declares Multiple as well, so this is a restatement — but
# the script must not depend on the template having been applied.
Invoke-Az @('containerapp', 'revision', 'set-mode', '--name', $appName, '--resource-group', $ResourceGroup, '--mode', 'multiple') | Out-Null
# --target-port is what installs the *application's* port. On the normal path it is now a harmless
# restatement: a first run creates the app in pass 2 (PLAN-030 review 4, option (b)), against the
# image just built, so the app already has port 4000 here - and so do its probes, because the
# template set them to 4000 when it was applied with a tagged image. Passing the flag on every run
# keeps that true whatever the environment's history.
#
# It still earns its place on the one path the two-pass create does not cover: an app created by an
# earlier, broken first run, whose probes are on the bootstrap image's port 80. A probe's `port` is a
# required field of the revision template (HTTPGet in the Container Apps REST spec), not part of the
# ingress, so no `az containerapp update` can move it - this flag moves the *ingress* to 4000, which
# is what lets this revision answer /api/health at all, and the next Bicep pass moves the probes to
# 4000 with it. That is why the flag is kept rather than dropped.
# The flag itself is confirmed: `target_port` is declared on the `containerapp` argument context
# (arg_group 'Ingress') in the CLI's own command module, so `az containerapp update` accepts it; the
# equivalent if a future CLI disagrees is `az containerapp ingress update --target-port 4000`.
#
# What is still unrun, and why: there is no Azure subscription in this repository's environment, so
# none of this has been executed - compiling the template (node scripts/azure/validate-bicep.mjs)
# and parsing this script are all that have run. The part that specifically wants a dev resource
# group is the second `az deployment group create` (createApp=true) and the first revision it
# produces: that is the call that was never possible before, and the one this fix turns on.
Invoke-Az @('containerapp', 'update', '--name', $appName, '--resource-group', $ResourceGroup,
    '--image', $image, '--target-port', '4000', '--revision-suffix', $revisionSuffix) | Out-Null
if (-not $WhatIf) {
    Write-Info 'waiting for the new revision to become healthy…'
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 10
        $state = (& az containerapp revision list --name $appName --resource-group $ResourceGroup --query "[?properties.revisionSuffix=='$revisionSuffix'].properties.healthState | [0]" -o tsv 2>$null)
        if ($state -in @('Healthy', 'Unhealthy', 'Degraded')) { break }
    }
    if ($state -ne 'Healthy') { throw "New revision is '$state'. Traffic was not shifted; the previous revision is still serving." }
}

Write-Step 'Health gate (on the new revision, before any traffic)'
if ($WhatIf) { Write-Info 'would call /api/health on the new revision with 0% traffic' }
else {
    $probe = & az containerapp revision show --name $appName --resource-group $ResourceGroup --revision $revisionSuffix --query "properties.fqdn" -o tsv
    $health = Invoke-WebRequest -Uri "https://$probe/api/health" -UseBasicParsing -TimeoutSec 30
    if ($health.StatusCode -ne 200) { throw "New revision did not answer /api/health (HTTP $($health.StatusCode)); traffic not shifted." }
    Write-Info "health: $($health.Content)"
}

Write-Step 'Traffic shift'
Invoke-Az @('containerapp', 'ingress', 'traffic', 'set', '--name', $appName, '--resource-group', $ResourceGroup, '--revision', $revisionSuffix, '--weight', '100') | Out-Null

Write-Step 'Verification'
if ($WhatIf) { Write-Info 'would re-check /api/health on the public endpoint' }
else {
    $fqdn = & az containerapp show --name $appName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
    foreach ($path in @('/api/health', '/')) {
        $response = Invoke-WebRequest -Uri "https://$fqdn$path" -UseBasicParsing -TimeoutSec 30
        Write-Info "$path -> HTTP $($response.StatusCode)"
        if ($response.StatusCode -ne 200) { throw "$path answered $($response.StatusCode) after the traffic shift. Roll back with: ./scripts/azure/deploy-env.ps1 -Environment $Environment -ImageTag <previous-tag>" }
    }
    Write-Host "`n$Environment deployed: https://$fqdn (revision $revisionSuffix, image $ImageTag)" -ForegroundColor Green
    Write-Host "Rollback: az containerapp ingress traffic set --name $appName --resource-group $ResourceGroup --revision <previous-revision> --weight 100" -ForegroundColor Yellow
    if ($Environment -eq 'dev') {
        Write-Host "Next step in the path: ./scripts/azure/deploy-env.ps1 -Environment prod -PromoteFrom dev -Yes" -ForegroundColor DarkGray
    } else {
        Write-Host "Production is running $ImageTag — the tag dev was verified on." -ForegroundColor DarkGray
    }
}
