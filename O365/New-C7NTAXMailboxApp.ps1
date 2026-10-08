<#
.SYNOPSIS
  Creates the Entra ID (Azure AD) app registration that the C7NTAX Microsoft 365 email connector
  needs, and grants it admin consent.

.DESCRIPTION
  This is PLAN-017 §4 (Flow A, app-only) and §5 (Flow B, delegated) turned into something that can
  be run. The plan document is the reference and the reasoning; this is the script, and the two are
  meant to be read together.

  Why it exists: the runbook is a list of portal clicks, and a portal click leaves no record of
  what was asked for. Everything here is Graph REST against the documented endpoints, so what the
  tenant ends up with is exactly what the plan says — `Mail.ReadWrite` **application** for an
  unattended watcher mailbox, or `Mail.ReadWrite` + `User.Read` + `offline_access` **delegated**
  for "Connect to Microsoft", plus the admin consent each one requires.

  `Mail.ReadWrite` and not `Mail.Read`: the connector marks a message read once it has turned it
  into a ticket, and that needs write.

  Authentication is the device-code flow using Microsoft's own Graph command-line client, so there
  is no module to install and no `az` to download. You approve a code in a browser; the script
  holds a user token for the length of the run and never stores it. The account running it needs
  the **Application Administrator** (or Global Administrator) role — creating an app registration
  and consenting to application permissions both require one.

  Nothing here is tenant-destructive: an existing registration with the same display name is
  reused rather than duplicated, and `-WhatIf` prints every call without making it.

.PARAMETER Mode
  AppOnly   a client secret, an unattended mailbox (PLAN-017 §4). The default.
  Delegated a person signs in from C7NTAX and consents (PLAN-017 §5). No secret needed.
  Both      one registration serving both flows.

.PARAMETER TenantId
  The Directory (tenant) ID, or a domain (`contoso.onmicrosoft.com`), or `common` for a
  multi-tenant app. With `common`, the script asks the token which tenant it landed in and
  reports it.

.PARAMETER RedirectUri
  The Web redirect URI the delegated flow returns to. Find it in C7NTAX: open the connector and
  press **Connect to Microsoft** — the API answers with the exact URI. Defaults to the documented
  development URI.

.PARAMETER DelegateMailbox
  Mailbox addresses to scope the app to (PLAN-017 §6). The script only *prints* the commands:
  Exchange Online RBAC lives in the Exchange cmdlets, not in Graph, so running them is a
  deliberate second step. Without it an app-only app can read every mailbox in the tenant.

.PARAMETER WhatIf
  Print every Graph call instead of making it.

.EXAMPLE
  # App-only, scoped to an unattended service desk mailbox
  ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -DelegateMailbox servicedesk@contoso.com

.EXAMPLE
  # Delegated only, for "Connect to Microsoft"
  ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -Mode Delegated `
    -RedirectUri https://psa.contoso.com/api/email-connectors/oauth/callback

.EXAMPLE
  # See the whole call sequence without touching the tenant
  ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [string]$TenantId,

  [ValidateSet("AppOnly", "Delegated", "Both")]
  [string]$Mode = "AppOnly",

  [string]$DisplayName = "C7NTAX Email Connector",

  [string]$RedirectUri = "http://localhost:4000/api/email-connectors/oauth/callback",

  [ValidateRange(1, 24)]
  [int]$SecretMonths = 12,

  # A public client (PKCE, no secret) is the documented default for the delegated flow. App-only
  # cannot use one: a client-credentials grant has to authenticate the caller.
  [switch]$PublicClient,

  [string[]]$DelegateMailbox = @(),

  # Microsoft's Graph command-line client. Overridable for a tenant that runs its own tooling app.
  [string]$AuthClientId = "14d82eec-204b-4c2f-b7e8-296a70dab67e",

  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$GraphBase = "https://graph.microsoft.com/v1.0"
$LoginBase = "https://login.microsoftonline.com"

# Fixed rather than looked up: a failed lookup would otherwise grant nothing at all, and a wrong id
# is reported by the consent step rather than passing silently.
$GraphResourceAppId = "00000003-0000-0000-c000-000000000000"

# Microsoft Graph roles and scopes by the name the plan uses. The GUIDs are the API's own
# identifiers — `Mail.ReadWrite` as an application permission is not the same id as the delegated
# scope of the same name, and using one where the other belongs is a silent no-op.
$GraphRoles = @{
  "Mail.ReadWrite" = @{ Application = "e2a3a72e-5f79-4c64-b1b1-878b674786c9"; Delegated = "024d486e-b451-40bb-833d-3e66d98c5c73" }
  "Mail.Read"      = @{ Application = "810c84a8-4a9e-49e6-bf7d-12d183f40d01"; Delegated = "570282fd-fa5c-430d-a7fd-fc8dc98a9dca" }
  "Mail.Send"      = @{ Application = "b633e1c5-b582-4048-a93e-9f11b44c7e96"; Delegated = "e383f46e-2787-4529-855e-0e479a3ffac0" }
  "User.Read.All"  = @{ Application = "df021288-bdef-4463-88db-98f22de89214"; Delegated = "a154be20-db9c-4678-8ab7-66f6cc099a59" }
  "User.Read"      = @{ Application = $null;                                  Delegated = "e1fe6dd8-ba31-4d61-89e7-88639da4683d" }
}

$ApplicationPermissions = @("Mail.ReadWrite")
$DelegatedPermissions = @("Mail.ReadWrite", "User.Read", "offline_access")

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $scriptDirectory "out" }
$results = [ordered]@{}
$script:AccessToken = $null
$script:ResolvedTenantId = $null

function Write-Step([string]$Text) { Write-Host "  $Text" -ForegroundColor Gray }
function Write-Head([string]$Text) { Write-Host "`n$Text" -ForegroundColor Cyan }

function Invoke-Graph {
  <#
    One verb, one place. `-WhatIf` short-circuits here rather than at each call site, so no caller
    can forget it and mutate a tenant during a dry run.
  #>
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [object]$Body
  )

  $uri = if ($Path -like "http*") { $Path } else { "$GraphBase$Path" }
  $payload = if ($PSBoundParameters.ContainsKey("Body") -and $null -ne $Body) { $Body | ConvertTo-Json -Depth 10 } else { $null }

  if ($WhatIfPreference) {
    Write-Host "    [whatif] $Method $uri" -ForegroundColor DarkGray
    if ($payload) { Write-Host "             $payload" -ForegroundColor DarkGray }
    return $null
  }

  $params = @{
    Method      = $Method
    Uri         = $uri
    Headers     = @{ Authorization = "Bearer $script:AccessToken" }
    ContentType = "application/json"
  }
  if ($payload) { $params["Body"] = $payload }

  try {
    Invoke-RestMethod @params
  } catch {
    # The Graph error body is the only useful part; the PowerShell wrapper hides it.
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    throw "Graph $Method $uri failed: $detail"
  }
}

function Get-GraphValue([string]$Path) {
  $response = Invoke-Graph -Method GET -Path $Path
  if ($WhatIfPreference -or $null -eq $response) { return @() }
  return @($response.value)
}

function Connect-ToGraph {
  Write-Head "1. Signing in"
  Write-Step "A device code follows. Open the URL, enter the code, and sign in as an account with"
  Write-Step "Application Administrator (or Global Administrator)."

  try {
    $device = Invoke-RestMethod -Method Post -Uri "$LoginBase/$TenantId/oauth2/v2.0/devicecode" `
      -Body @{ client_id = $AuthClientId; scope = "https://graph.microsoft.com/.default" }
  } catch {
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    # The first thing anyone gets wrong is the tenant, so it is the one failure worth naming: the
    # raw AADSTS90002 body is accurate but says nothing about where the value comes from.
    if ($detail -match "AADSTS90002|90002") {
      throw "Tenant '$TenantId' was not found. Use the Directory (tenant) ID from Entra admin centre, Overview, or the tenant's primary domain such as contoso.onmicrosoft.com. ($detail)"
    }
    throw "Could not reach the Microsoft sign-in endpoint: $detail"
  }

  Write-Host ""
  Write-Host "    $($device.message)" -ForegroundColor Yellow
  Write-Host ""

  $interval = if ($device.interval) { [int]$device.interval } else { 5 }
  $deadline = (Get-Date).AddSeconds([int]$device.expires_in)

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $interval
    try {
      $token = Invoke-RestMethod -Method Post -Uri "$LoginBase/$TenantId/oauth2/v2.0/token" -Body @{
        grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
        client_id   = $AuthClientId
        device_code = $device.device_code
      }
      $script:AccessToken = $token.access_token
      Write-Host "    Signed in." -ForegroundColor Green

      # The signed-in account is reported because the most common failure by far is being signed in
      # as an account that turns out not to be an administrator halfway through the run.
      $claims = $script:AccessToken.Split(".")[1].Replace("-", "+").Replace("_", "/")
      switch ($claims.Length % 4) { 2 { $claims += "==" } 3 { $claims += "=" } }
      $claimsJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($claims)) | ConvertFrom-Json
      $account = $claimsJson.upn; if (-not $account) { $account = $claimsJson.preferred_username }
      Write-Step "Account: $account"
      $script:ResolvedTenantId = $claimsJson.tid
      Write-Step "Tenant:  $($claimsJson.tid)"
      return
    } catch {
      $message = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
      if ($message -match "authorization_pending") { continue }
      if ($message -match "slow_down") { $interval += 2; continue }
      throw "Sign-in failed: $message"
    }
  }
  throw "The device code expired before it was approved. Run the script again."
}

function Get-OrCreateApplication {
  Write-Head "2. App registration '$DisplayName'"

  $existing = Get-GraphValue "/applications?`$filter=displayName eq '$DisplayName'&`$select=id,appId,displayName"

  $body = @{
    displayName    = $DisplayName
    signInAudience = "AzureADMyOrg"
    # A public client is one that cannot keep a secret — the delegated flow's documented default
    # (PKCE, no secret). It has to be declared, or the token endpoint rejects a code exchange that
    # carries no client secret.
    isFallbackPublicClient = ($PublicClient -or $Mode -eq "Delegated")
  }

  if ($existing.Count -gt 0) {
    $app = $existing[0]
    Write-Step "Reusing the existing registration $($app.appId)."
    if ($PSCmdlet.ShouldProcess($DisplayName, "Update the app registration")) {
      $updated = Invoke-Graph -Method PATCH -Path "/applications/$($app.id)" -Body $body
      if (-not $WhatIfPreference) { $app = $updated }
    }
  } else {
    if ($PSCmdlet.ShouldProcess($DisplayName, "Create the app registration")) {
      $app = Invoke-Graph -Method POST -Path "/applications" -Body $body
      Write-Step "Created $($app.appId)."
    }
  }

  if ($WhatIfPreference) {
    # A dry run has no ids to carry forward, so it continues with stand-ins. That keeps the whole
    # call sequence visible in one pass, which is the point of -WhatIf.
    $app = [pscustomobject]@{ id = "<object-id>"; appId = "<client-id>"; displayName = $DisplayName }
  }

  $results["objectId"] = $app.id
  $results["clientId"] = $app.appId
  $results["secret"] = $null
  $results["secretExpiry"] = $null
  return $app
}

function Set-RequiredPermissions {
  param([object]$App)

  Write-Head "3. Requesting permissions"

  $access = @()
  if ($Mode -in @("AppOnly", "Both")) {
    foreach ($name in $ApplicationPermissions) {
      $id = $GraphRoles[$name].Application
      if (-not $id) { throw "$name has no application role id. Check the GraphRoles table." }
      $access += @{ id = $id; type = "Role" }
    }
    Write-Step "Application: $($ApplicationPermissions -join ', ')"
  }
  if ($Mode -in @("Delegated", "Both")) {
    foreach ($name in $DelegatedPermissions) {
      # offline_access is an OIDC scope with no resource role id, so it is consented by name at
      # sign-in and is not part of requiredResourceAccess.
      $id = $GraphRoles[$name].Delegated
      if (-not $id) { continue }
      $access += @{ id = $id; type = "Scope" }
    }
    Write-Step "Delegated:   $($DelegatedPermissions -join ', ')"
  }

  Invoke-Graph -Method PATCH -Path "/applications/$($App.id)" -Body @{
    requiredResourceAccess = @(@{ resourceAppId = $GraphResourceAppId; resourceAccess = $access })
  } | Out-Null

  if ($Mode -in @("Delegated", "Both")) {
    Write-Step "Redirect URI: $RedirectUri"
    Invoke-Graph -Method PATCH -Path "/applications/$($App.id)" -Body @{ web = @{ redirectUris = @($RedirectUri) } } | Out-Null
  }
}

function Get-OrCreateServicePrincipal {
  param([object]$App)

  Write-Head "4. Service principal"

  $existing = Get-GraphValue "/servicePrincipals?`$filter=appId eq '$($App.appId)'&`$select=id,appId"
  if ($existing.Count -gt 0) {
    Write-Step "Already present ($($existing[0].id))."
    return $existing[0]
  }

  if ($PSCmdlet.ShouldProcess($DisplayName, "Create the service principal")) {
    # Without a service principal in the tenant there is nothing to consent *for*: an application
    # object on its own is a template, and both the role assignment and the permission grant point
    # at this object's id.
    $sp = Invoke-Graph -Method POST -Path "/servicePrincipals" -Body @{ appId = $App.appId }
    Write-Step "Created $($sp.id)."
    if ($WhatIfPreference) { $sp = [pscustomobject]@{ id = "<sp-id>"; appId = $App.appId } }
    return $sp
  }
  return [pscustomobject]@{ id = "<sp-id>"; appId = $App.appId }
}

function Get-GraphServicePrincipal {
  $sp = Get-GraphValue "/servicePrincipals?`$filter=appId eq '$GraphResourceAppId'&`$select=id,appId"
  if ($sp.Count -eq 0) {
    if ($WhatIfPreference) { return [pscustomobject]@{ id = "<graph-sp-id>" } }
    throw "The Microsoft Graph service principal is missing from this tenant, which should not be possible."
  }
  return $sp[0]
}

function Grant-AdminConsent {
  param([object]$App, [object]$ServicePrincipal, [object]$GraphServicePrincipal)

  Write-Head "5. Admin consent"

  if ($Mode -in @("AppOnly", "Both")) {
    foreach ($name in $ApplicationPermissions) {
      # Three ids, and all three are load-bearing: principal is the client, resource is Graph, and
      # appRole is the permission. Graph rejects the assignment if any one of them is wrong.
      Invoke-Graph -Method POST -Path "/servicePrincipals/$($GraphServicePrincipal.id)/appRoleAssignedTo" -Body @{
        principalId = $ServicePrincipal.id
        resourceId  = $GraphServicePrincipal.id
        appRoleId   = $GraphRoles[$name].Application
      } | Out-Null
      Write-Step "Granted (application) $name"
    }
  }

  if ($Mode -in @("Delegated", "Both")) {
    $scopeString = ($DelegatedPermissions | Where-Object { $_ -ne "offline_access" }) -join " "
    Invoke-Graph -Method POST -Path "/oauth2PermissionGrants" -Body @{
      clientId    = $ServicePrincipal.id
      consentType = "AllPrincipals"
      resourceId  = $GraphServicePrincipal.id
      scope       = $scopeString
    } | Out-Null
    Write-Step "Granted (delegated) $scopeString"
  }
}

function New-ClientSecret {
  param([object]$App)

  Write-Head "6. Client secret"

  if ($Mode -eq "Delegated" -or $PublicClient) {
    Write-Step "Not created — the delegated flow uses PKCE with no secret."
    return
  }

  $end = (Get-Date).ToUniversalTime().AddMonths($SecretMonths).ToString("yyyy-MM-ddTHH:mm:ssZ")
  $secret = Invoke-Graph -Method POST -Path "/applications/$($App.id)/addPassword" -Body @{
    passwordCredential = @{
      displayName = "{0}-{1:yyyy-MM}" -f $DisplayName, (Get-Date).ToUniversalTime()
      endDateTime = $end
    }
  }

  if ($WhatIfPreference) {
    $results["secret"] = "<secret-value>"
    return
  }

  # Shown once and never retrievable again, which is why it is written to the output file in the
  # same breath rather than left to a copy-and-paste from the console.
  $results["secret"] = $secret.secretText
  $results["secretExpiry"] = $secret.endDateTime
  $results["secretKeyId"] = $secret.keyId
  Write-Step "Created, expiring $($secret.endDateTime)."
  Write-Warning "Diary this expiry 30 days ahead. PLAN-017 A3: a dead secret surfaces in the connector as AADSTS7000222, and nothing warns you first."
}

function Write-MailboxScopingCommands {
  param([object]$App, [object]$ServicePrincipal)

  Write-Head "7. Scope the app to its mailbox (PLAN-017 section 6)"

  if ($Mode -eq "Delegated") {
    Write-Step "Not applicable: a delegated token can only reach the mailbox that signed in."
    return
  }

  if ($DelegateMailbox.Count -eq 0) {
    Write-Warning "No -DelegateMailbox given. Until the app is scoped, it can read EVERY mailbox in the tenant."
  }

  $mailbox = if ($DelegateMailbox.Count -gt 0) { $DelegateMailbox[0] } else { "<service-desk-mailbox>" }
  $scopeName = "C7NTAX-$($App.appId.ToString().Substring(0, 8))"

  Write-Host @"

    These run in Exchange Online PowerShell, not here — Graph has no route to them, and they need
    the app to have been consented first. Run them after this script.

        Install-Module ExchangeOnlineManagement -Scope CurrentUser
        Connect-ExchangeOnline

        # 1. The app's identity inside Exchange Online
        New-ServicePrincipal -AppId $($App.appId) -ObjectId $($ServicePrincipal.id) -DisplayName "$DisplayName"

        # 2. A management scope bound to the one mailbox
        New-ManagementScope -Name "$scopeName" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$mailbox'"

        # 3. The mailbox role, restricted to that scope
        New-ManagementRoleAssignment -Name "$scopeName-Assignment" -App "$DisplayName" ``
          -Role "Application Mail.ReadWrite" -CustomResourceScope "$scopeName"

    Verify both halves — the first proves access, the second proves it is scoped:

        Test-ServicePrincipalAuthorization -Identity $($App.appId) -Resource $mailbox
        Get-ManagementRoleAssignment -RoleAssignee "$DisplayName" | Format-Table Name, Role, CustomResourceScope

"@ -ForegroundColor Gray

  if ($DelegateMailbox.Count -gt 1) {
    Write-Step "Each additional mailbox needs its own scope and assignment:"
    foreach ($extra in $DelegateMailbox[1..($DelegateMailbox.Count - 1)]) { Write-Step "  $extra" }
  }
}

# ── Main ──────────────────────────────────────────────────────────────────────
Write-Host "`nC7NTAX — Microsoft 365 app registration" -ForegroundColor White
Write-Host "Tenant:  $TenantId"
Write-Host "Mode:    $Mode"
if ($WhatIfPreference) { Write-Host "DRY RUN — nothing will be called on the tenant." -ForegroundColor Yellow }

Connect-ToGraph

$app = Get-OrCreateApplication
Set-RequiredPermissions -App $app
$sp = Get-OrCreateServicePrincipal -App $app
$graphSp = Get-GraphServicePrincipal
Grant-AdminConsent -App $app -ServicePrincipal $sp -GraphServicePrincipal $graphSp
New-ClientSecret -App $app
Write-MailboxScopingCommands -App $app -ServicePrincipal $sp

# ── Results ───────────────────────────────────────────────────────────────────
$results["tenantId"] = if ($script:ResolvedTenantId) { $script:ResolvedTenantId } else { $TenantId }
$results["displayName"] = $DisplayName
$results["mode"] = $Mode
$results["redirectUri"] = if ($Mode -in @("Delegated", "Both")) { $RedirectUri } else { $null }
$results["permissions"] = @{
  application = if ($Mode -in @("AppOnly", "Both")) { $ApplicationPermissions } else { @() }
  delegated   = if ($Mode -in @("Delegated", "Both")) { $DelegatedPermissions } else { @() }
}
$results["createdAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

Write-Head "Done"

if (-not $WhatIfPreference) {
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $file = Join-Path $OutputDirectory "c7ntax-m365-app.json"
  $results | ConvertTo-Json -Depth 6 | Set-Content -Path $file -Encoding UTF8
  Write-Step "Written to $file"
  Write-Warning "That file holds the client secret in clear text. It is git-ignored — move it somewhere safe and delete it once the connector is configured."
}

$watchMailbox = if ($DelegateMailbox.Count -gt 0) { $DelegateMailbox[0] } else { "(delegated: the signed-in account)" }
$secretLine = if ($results["secret"]) { $results["secret"] } else { "(none — public client, leave the field empty)" }

Write-Host @"

    Paste these into C7NTAX — Administration, CloudConnect, the Microsoft 365 connector
    (PLAN-017 section 7):

        Directory (tenant) ID      $($results["tenantId"])
        Application (client) ID    $($results["clientId"])
        Client secret              $secretLine
        Mailbox to watch           $watchMailbox

    Then press Test connection, then Poll now.

    Consent can take 30-60 minutes to propagate. An immediate ErrorAccessDenied is expected, not a
    misconfiguration. PLAN-017 section 7 has the troubleshooting matrix.

"@ -ForegroundColor White
