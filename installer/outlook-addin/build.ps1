<#
.SYNOPSIS
  Builds the Windows installer for the C7NTAX Outlook add-in.

.DESCRIPTION
  The installer's whole job is to place a manifest and register it, so this script's first
  job is to obtain a manifest that is actually usable: the copy in `apps/outlook-addin` still
  holds `__ADDIN_HOST__` and `__ADDIN_GUID__`, and a manifest with placeholders is one Office
  rejects without explaining why.

  That manifest is fetched from a running C7NTAX, from `GET /addin/manifest.xml`, because the
  server is the only thing that knows both the deployment's public origin and the add-in
  identity in force (`PUBLIC_BASE_URL` and `OUTLOOK_ADDIN_GUID`). Asking the server rather
  than substituting here means the installer and the manifest a user downloads by hand can
  never disagree — one source of truth for both values.

  The consequence is worth stating plainly: **the installer is built for one origin.** An
  installer built against a development server registers a manifest pointing at that server.
  Build it against the origin your users' Outlook can reach, and rebuild it when that origin
  changes. The deployment report in Administration, System Settings compares the two and says
  so when they differ.

.PARAMETER ApiUrl
  The running C7NTAX to take the manifest from, e.g. https://tax.cyber7group.com. Defaults to
  the local API.

.PARAMETER ManifestPath
  Use a manifest file instead of asking a server. For a build with no API reachable.

.PARAMETER Version
  Overrides the MSI package version. The plugin version normally comes from `plugin.json`, which
  `pnpm plugin:bump` maintains — do not pass this unless you are testing the packaging itself.

.PARAMETER OutputDirectory
  Where the artifacts and the history `index.json` go. Defaults to `installer/artifacts`.

.EXAMPLE
  ./build.ps1 -ApiUrl https://tax.cyber7group.com

.EXAMPLE
  ./build.ps1 -ApiUrl http://localhost:4000
#>
[CmdletBinding()]
param(
  [Parameter(ParameterSetName = "Server")]
  [string]$ApiUrl = "http://localhost:4000",

  [Parameter(Mandatory, ParameterSetName = "File")]
  [string]$ManifestPath,

  [string]$Version,

  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "installer\artifacts" }

# ── The toolkit ───────────────────────────────────────────────────────────────
# WiX is a dotnet tool. Version 5 rather than the newest: the toolset began requiring
# acceptance of its Open Source Maintenance Fee from v6, and that is a licensing decision for
# the business to make deliberately rather than for a build script to accept.
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
  throw "wix was not found. Install it with: dotnet tool install --global wix --version '5.*'"
}
$wixVersion = (& wix --version) -split '\+' | Select-Object -First 1

# ── Stage the manifest ────────────────────────────────────────────────────────
$stage = Join-Path $env:TEMP ("c7ntax-addin-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$stagedManifest = Join-Path $stage "manifest.xml"

try {
  if ($PSCmdlet.ParameterSetName -eq "Server") {
    $url = $ApiUrl.TrimEnd("/") + "/addin/manifest.xml"
    Write-Host "Fetching the manifest from $url" -ForegroundColor Cyan
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing
    } catch {
      throw "Could not fetch $url. Start the API (pnpm --filter @C7NTAX/api dev), point -ApiUrl at the deployment, or use -ManifestPath. $($_.Exception.Message)"
    }
    # A 404 here is the add-in being switched off, which reads as a missing file rather than a
    # disabled feature — worth naming, because the fix is a setting rather than a deployment.
    [System.IO.File]::WriteAllText($stagedManifest, $response.Content)
  } else {
    Copy-Item -Path $ManifestPath -Destination $stagedManifest -Force
  }

  # Parsed textually: the manifest's default XML namespace defeats an unprefixed
  # SelectSingleNode, and the two values wanted here are unambiguous in the source.
  $raw = Get-Content -Path $stagedManifest -Raw

  if ($raw -match "__ADDIN_(HOST|GUID)__") {
    throw "The manifest still contains a placeholder — it came from the file on disk rather than a server. Point -ApiUrl at a running C7NTAX."
  }
  if ($raw -notmatch "<Id>\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*</Id>") {
    throw "The manifest has no <Id> GUID. Office identifies the add-in by it, and the package registers that identifier."
  }
  $addinId = $matches[1].ToLowerInvariant()
  if ($raw -notmatch 'SourceLocation\s+DefaultValue="(https?://[^/"]+)') {
    throw "The manifest has no absolute SourceLocation, so there is no origin to report or to warn about."
  }
  $origin = $matches[1]
  if ($origin -notlike "https://*") {
    # Office refuses a non-HTTPS SourceLocation, so this is a warning about where the artifact
    # may be used rather than a build failure: a developer needs a localhost package to test with.
    Write-Warning "The manifest's URLs are $origin, which is not HTTPS. Office will not load the add-in from there; this package is for local testing only."
  }
  Write-Host "Add-in id  $addinId" -ForegroundColor Cyan
  Write-Host "Origin     $origin" -ForegroundColor Cyan

  # ── The README installed beside the manifest ────────────────────────────────
  $stagedReadme = Join-Path $stage "README.txt"
  (Get-Content -Path (Join-Path $scriptDir "install-README.template.txt") -Raw) `
    -replace "__ADDIN_HOST__", $origin `
    -replace "__ADDIN_ID__", $addinId | Set-Content -Path $stagedReadme -Encoding UTF8

  # ── The plugin, and the version ─────────────────────────────────────────────
  # The plugin's identity, version and payload hash come from its own record, through the same
  # node implementation the API and the guard use — so the version an operator reads on the
  # install page is the version stamped into this MSI, and the artifact records exactly which
  # payload it was built from.
  $meta = (& node (Join-Path $repoRoot "scripts\plugin-metadata.mts") print) | ConvertFrom-Json
  if (-not $meta.version -or $meta.version -eq "0.0.0") {
    throw "The plugin has no version. Run: pnpm plugin:bump"
  }
  if ($meta.sourceHash -ne $meta.actualHash) {
    # The rule the whole record exists for: a plugin that changed without being versioned must not
    # produce an installer, or the history would show two different payloads under one version.
    throw "The plugin payload has changed since it was versioned. Run: pnpm plugin:bump (and rebuild the installer)."
  }

  $productVersion = $meta.release
  if (-not $Version) { $Version = $meta.version }
  if ($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$' -or
      [int]($Version -split '\.')[0] -ge 256 -or
      [int]($Version -split '\.')[1] -ge 256 -or
      [int]($Version -split '\.')[2] -ge 65536) {
    throw "Version must be major(<256).minor(<256).build(<65536) for Windows Installer: got '$Version'."
  }
  Write-Host "Plugin     $($meta.version) (release $productVersion)" -ForegroundColor Cyan
  Write-Host "Payload    $($meta.actualHash.Substring(0,12))" -ForegroundColor Cyan

  # ── Build ───────────────────────────────────────────────────────────────────
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  # Named for the plugin version, because that is what the package registers: an operator reading
  # a filename in a downloads folder is reading the version of the add-in they are about to install.
  $fileName = "C7NTAX-OutlookAddIn-$($meta.version).msi"
  $artifact = Join-Path $OutputDirectory $fileName
  # WiX appends to an existing package rather than replacing it, which produced a 5 MB
  # installer the first time it was rebuilt over itself.
  if (Test-Path $artifact) { Remove-Item $artifact -Force }

  $wixArgs = @(
    "build", (Join-Path $scriptDir "C7NTAX-OutlookAddIn.wxs"),
    "-d", "ManifestSource=$stagedManifest",
    "-d", "ReadmeSource=$stagedReadme",
    "-d", "AddinId=$addinId",
    "-d", "ProductVersion=$Version",
    "-o", $artifact
  )
  Write-Host "Building $fileName with WiX $wixVersion" -ForegroundColor Cyan
  & wix @wixArgs
  if ($LASTEXITCODE -ne 0) { throw "wix build failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path $artifact)) { throw "wix reported success but produced no artifact at $artifact" }

  # ── Record what was built, and keep every version before it ─────────────────
  # An MSI is a binary: its version, the origin baked into it and the payload it came from cannot
  # be read back out. This record is those facts, and the history is what makes a rollback
  # possible — a plugin change can be the reason a mailbox misbehaves, and the remedy is to
  # install the version that worked rather than to wait for a fix.
  $entry = [ordered]@{
    fileName       = $fileName
    pluginVersion  = $meta.version
    # The application release the plugin shipped in, so a version traces back to BuildNotes.
    productVersion = $productVersion
    addinHost      = $origin
    addinId        = $addinId
    # Which payload this installer was built from. The guard compares it against the plugin's own
    # files, which is how "the plugin changed and the installer did not" becomes a failure rather
    # than something somebody has to remember.
    sourceHash     = $meta.actualHash
    builtAt        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    sha256         = (Get-FileHash -Path $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    size           = (Get-Item $artifact).Length
    wix            = $wixVersion
  }

  $indexPath = Join-Path $OutputDirectory "index.json"
  $releases = @()
  if (Test-Path $indexPath) {
    try { $releases = @((Get-Content -Path $indexPath -Raw | ConvertFrom-Json).releases) } catch { $releases = @() }
  }
  # Newest first, and a rebuild of the same version replaces its entry rather than appearing twice:
  # two rows for one version would make "last known good" ambiguous.
  $kept = @($releases | Where-Object { $_ -and $_.fileName -ne $fileName })
  [ordered]@{ latest = $fileName; releases = @($entry) + $kept } |
    ConvertTo-Json -Depth 5 | Set-Content -Path $indexPath -Encoding UTF8

  # The old single-build record is superseded by the history; leaving it would be a second answer
  # to the same question.
  Remove-Item -Path (Join-Path $OutputDirectory "build.json") -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Built $artifact" -ForegroundColor Green
  Write-Host ("  {0:N0} bytes, sha256 {1}" -f $entry.size, $entry.sha256)
  Write-Host "  Install it with:  msiexec /i `"$artifact`" /qn"
  Write-Host "  Or per-user only: msiexec /i `"$artifact`" ALLUSERS=2 MSIINSTALLPERUSER=1"
  Write-Host "  History now holds $(@($entry) + $kept | Measure-Object | Select-Object -ExpandProperty Count) version(s) in $OutputDirectory"
}
finally {
  Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
}
