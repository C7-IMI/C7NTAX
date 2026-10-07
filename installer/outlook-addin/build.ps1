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
  The package version, X.Y.Z. Defaults to the version from `BuildNotes.md`, which is where this
  repository already keeps it.

.PARAMETER OutputDirectory
  Where the artifact and its `build.json` go. Defaults to `installer/artifacts`.

.EXAMPLE
  ./build.ps1 -ApiUrl https://tax.cyber7group.com

.EXAMPLE
  ./build.ps1 -ApiUrl http://localhost:4000 -Version 2026.10.7
#>
[CmdletBinding(DefaultParameterSetName = "Server")]
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

  # ── The version ─────────────────────────────────────────────────────────────
  if (-not $Version) {
    # BuildNotes.md is this repository's record of the current release, so the installer takes
    # its version from the same place the changelog does rather than inventing one. Its versions
    # carry four parts (2026.10.7.031), and Windows Installer cannot accept that: the major field
    # must be below 256 and the build field below 65536, so a four-digit year does not fit.
    #
    # Mapped to YY.M.PPPP instead — 2026.10.7.031 becomes 26.10.7031 — which keeps every field in
    # range, stays monotonic as the changelog advances (patch dominates, the build number breaks
    # ties) and leaves the true version in `build.json` and in the Add/Remove Programs entry's
    # help link. A version that cannot order two builds correctly would break MajorUpgrade, and
    # the failure would look like an upgrade that silently did nothing.
    $buildNotes = Join-Path $repoRoot "BuildNotes.md"
    $match = Select-String -Path $buildNotes -Pattern '^##\s+(\d{4})\.(\d+)\.(\d+)\.(\d+)' | Select-Object -First 1
    if (-not $match) { throw "Could not read a version from $buildNotes. Pass -Version explicitly." }
    $g = $match.Matches[0].Groups
    $productVersion = "$($g[1].Value).$($g[2].Value).$($g[3].Value).$($g[4].Value)"
    $Version = "{0}.{1}.{2}" -f $g[1].Value.Substring(2), $g[2].Value, ([int]$g[3].Value * 1000 + [int]$g[4].Value)
  } else {
    $productVersion = $Version
  }
  if ($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$' -or
      [int]($Version -split '\.')[0] -ge 256 -or
      [int]($Version -split '\.')[1] -ge 256 -or
      [int]($Version -split '\.')[2] -ge 65536) {
    throw "Version must be major(<256).minor(<256).build(<65536) for Windows Installer: got '$Version'."
  }

  # ── Build ───────────────────────────────────────────────────────────────────
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $fileName = "C7NTAX-OutlookAddIn-$productVersion.msi"
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

  # ── Record what was built ───────────────────────────────────────────────────
  # An MSI is a binary: the version and the origin inside it cannot be read back out, and the
  # application has to be able to tell an operator whether the installer it is offering belongs
  # to this server. This is that record, and it lives beside the artifact so the two travel
  # together.
  $info = [ordered]@{
    fileName = $fileName
    version  = $Version
    # The version the changelog carries. Reported separately because the two differ by design:
    # Windows Installer cannot hold a four-digit year in its major field.
    productVersion = $productVersion
    addinHost = $origin
    addinId  = $addinId
    builtAt  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    sha256   = (Get-FileHash -Path $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    size     = (Get-Item $artifact).Length
    wix      = $wixVersion
  }
  $info | ConvertTo-Json | Set-Content -Path (Join-Path $OutputDirectory "build.json") -Encoding UTF8

  Write-Host ""
  Write-Host "Built $artifact" -ForegroundColor Green
  Write-Host ("  {0:N0} bytes, sha256 {1}" -f $info.size, $info.sha256)
  Write-Host "  Install it with:  msiexec /i `"$artifact`" /qn"
  Write-Host "  Or per-user only: msiexec /i `"$artifact`" ALLUSERS=2 MSIINSTALLPERUSER=1"
}
finally {
  Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
}
