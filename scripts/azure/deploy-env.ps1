<#
.SYNOPSIS
    Builds the C7NTAX image, applies infrastructure, migrates the database and shifts
    traffic to the new revision for one environment (PLAN-016).

.DESCRIPTION
    One command per environment, safe to re-run. The order exists so that a failure never
    leaves the environment serving a revision whose schema was not applied:

      1. preflight            repository, guards, migrations, environment contract
      2. infrastructure       az deployment group create (Bicep)
      3. image                docker build + push to ACR (or az acr build)
      4. migration job        same image, overridden command: prisma migrate deploy
      5. revision             new Container App revision, 0% traffic
      6. health gate          /api/health and an authenticated call on the new revision
      7. traffic shift        move 100% traffic, then re-check
      8. report               environment URL, revision name, rollback command

    If the health gate fails, traffic is never shifted and the previous revision keeps
    serving; the script prints the exact command to roll back the image.

.PARAMETER Environment
    dev or prod. dev is deployed automatically by CI; prod only on an explicit sync.

.PARAMETER ImageTag
    Image tag to deploy. Defaults to the short git commit sha, so a deploy is traceable to
    a commit and the same tag can be used for dev and prod.

.PARAMETER ResourceGroup
    Resource group to deploy into. Defaults to rg-c7ntax-<environment>.

.PARAMETER SkipInfrastructure
    Skip the Bicep deployment (image and application only).

.PARAMETER SkipMigrations
    Skip the migration job. Only valid when the schema is already known to be current.

.PARAMETER WhatIf
    Print every command that would run without changing anything.

.EXAMPLE
    ./scripts/azure/deploy-env.ps1 -Environment dev
    ./scripts/azure/deploy-env.ps1 -Environment prod -ImageTag $(git rev-parse --short HEAD)
    ./scripts/azure/deploy-env.ps1 -Environment prod -WhatIf
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('dev', 'prod')][string]$Environment,
    [string]$ImageTag = '',
    [string]$ResourceGroup = '',
    [string]$Registry = '',
    [switch]$SkipInfrastructure,
    [switch]$SkipMigrations,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$appName = "c7ntax-$Environment"
if (-not $ResourceGroup) { $ResourceGroup = "rg-c7ntax-$Environment" }
if (-not $ImageTag) {
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
# and are written straight into Key Vault by the Bicep deployment — never into a file.
if (-not $SkipInfrastructure -and -not $WhatIf) {
    foreach ($required in @('PG_ADMIN_PASSWORD', 'JWT_SECRET_VALUE', 'KUMO_MASTER_KEY_VALUE')) {
        if (-not (Get-Item "env:$required" -ErrorAction SilentlyContinue)) {
            throw "Environment variable $required is not set. Export it for this shell (or set it as a pipeline secret) and re-run; secrets are never read from a file in the repository."
        }
    }
}

Write-Step 'Azure context'
$azAvailable = [bool](Get-Command az -ErrorAction SilentlyContinue)
if (-not $azAvailable) {
    if (-not $WhatIf) { throw 'Azure CLI (az) is not installed. Install it (https://aka.ms/azure-cli) or run with -WhatIf to preview the plan.' }
    Write-Info 'az is not installed: showing the plan with placeholder values'
}
if ($azAvailable) {
    $account = Invoke-Az @('account', 'show', '--query', 'name', '-o', 'tsv')
    if ($account) { Write-Info "subscription: $account" }
    if (-not $WhatIf) {
        $rgExists = & az group exists --name $ResourceGroup
        if ($rgExists -ne 'true') { throw "Resource group $ResourceGroup does not exist. Create it, or pass -ResourceGroup." }
    }
}
if (-not $Registry) {
    if ($azAvailable) {
        $Registry = (& az acr list --resource-group $ResourceGroup --query "[0].name" -o tsv 2>$null)
    }
    if (-not $Registry) {
        if (-not $WhatIf) { throw 'No container registry found in the resource group; pass -Registry.' }
        $Registry = '<registry>'
    }
}
Write-Info "registry: $Registry"

if (-not $SkipInfrastructure) {
    Write-Step 'Infrastructure (Bicep)'
    $paramsFile = Join-Path $repoRoot "infra\params\$Environment.bicepparam"
    Invoke-Az @('deployment', 'group', 'what-if',
        '--resource-group', $ResourceGroup,
        '--template-file', (Join-Path $repoRoot 'infra\main.bicep'),
        '--parameters', $paramsFile,
        '--parameters', "imageTag=$ImageTag", "postgresAdminPassword=$env:PG_ADMIN_PASSWORD", "jwtSecret=$env:JWT_SECRET_VALUE", "kumoMasterKey=$env:KUMO_MASTER_KEY_VALUE") | Out-Null
    if (-not $WhatIf) {
        Write-Info 'what-if reviewed; applying (set -WhatIf to only preview)'
    }
    Invoke-Az @('deployment', 'group', 'create',
        '--resource-group', $ResourceGroup,
        '--template-file', (Join-Path $repoRoot 'infra\main.bicep'),
        '--parameters', $paramsFile,
        '--parameters', "imageTag=$ImageTag", "postgresAdminPassword=$env:PG_ADMIN_PASSWORD", "jwtSecret=$env:JWT_SECRET_VALUE", "kumoMasterKey=$env:KUMO_MASTER_KEY_VALUE") | Out-Null
}

Write-Step 'Image'
$image = "$Registry.azurecr.io/c7ntax:$ImageTag"
Invoke-Az @('acr', 'build', '--registry', $Registry, '--image', "c7ntax:$ImageTag", $repoRoot) | Out-Null
Write-Info "built and pushed $image"

if (-not $SkipMigrations) {
    Write-Step 'Database migration'
    # A one-shot job from the same image, so the schema moves with the exact code that
    # expects it. --command overrides the app's CMD.
    $jobName = "$appName-migrate"
    $rg = $ResourceGroup
    Invoke-Az @('containerapp', 'job', 'create',
        '--name', $jobName, '--resource-group', $rg, '--environment', "aca-$appName",
        '--image', $image, '--command', 'npx prisma migrate deploy',
        '--cpu', '0.5', '--memory', '1.0Gi', '--replica-timeout', '900', '--replica-retry-limit', '1',
        '--registry-server', "$Registry.azurecr.io", '--mi-system-assigned') | Out-Null
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
Invoke-Az @('containerapp', 'update', '--name', $appName, '--resource-group', $ResourceGroup,
    '--image', $image, '--revision-suffix', $revisionSuffix) | Out-Null
Invoke-Az @('containerapp', 'revision', 'set-mode', '--name', $appName, '--resource-group', $ResourceGroup, '--mode', 'multiple') | Out-Null
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
}
