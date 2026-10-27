# Gmail MCP (multi-account) setup for Windows.
# Run by double-clicking "Set up Gmail MCP.cmd" in this folder.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Step($n, $text) { Write-Host ""; Write-Host "STEP $n  $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  !   $text" -ForegroundColor Yellow }
function Ask($q) { $a = Read-Host "$q [Y/N]"; return ($a -match '^[Yy]') }

Write-Host "=============================================================="
Write-Host "  Gmail MCP (both inboxes) setup"
Write-Host "  Access: read + drafts only. It cannot send, delete or relabel."
Write-Host "=============================================================="

# ---- 1. Node.js -------------------------------------------------------
Step 1 "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn "Node.js isn't installed."
  if (Ask "Install Node.js LTS now with winget?") {
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
  if (-not $node) { Warn "Install Node.js from https://nodejs.org (LTS), then run this again."; exit 1 }
}
Ok ("Node " + (& node --version) + " at " + $node.Source)

# ---- 2. Dependencies --------------------------------------------------
Step 2 "Installing dependencies (one-time, about a minute)"
if (-not (Test-Path (Join-Path $here 'node_modules\googleapis'))) {
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Warn "npm install failed (see above)."; exit 1 }
}
Ok "Dependencies ready"

# ---- 3. Google OAuth client file ---------------------------------------
Step 3 "Google sign-in client"
$cfgDir = Join-Path $env:USERPROFILE '.gmail-mcp'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$keys = Join-Path $cfgDir 'oauth-keys.json'
if (-not (Test-Path $keys)) {
  $dl = Join-Path $env:USERPROFILE 'Downloads'
  $found = Get-ChildItem -Path $dl -Filter 'client_secret_*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $found) {
    Warn "Couldn't find client_secret_*.json in your Downloads folder."
    Warn "Finish the Google Cloud steps (Create client > Desktop app > Download JSON), then run this again."
    exit 1
  }
  $j = Get-Content $found.FullName -Raw | ConvertFrom-Json
  if (-not $j.installed) { Warn "$($found.Name) isn't a 'Desktop app' client. Create a Desktop app client and download its JSON."; exit 1 }
  Copy-Item $found.FullName $keys
  Ok "Copied $($found.Name) to $keys"
} else { Ok "Found $keys" }

# ---- 4. Sign in to both accounts ----------------------------------------
Step 4 "Sign in to each Gmail account (a browser tab opens for each)"
$accounts = @(
  @{ alias = 'personal'; email = 'you@gmail.com' },
  @{ alias = 'school';   email = 'you@school.edu' }
)
foreach ($a in $accounts) {
  $cred = Join-Path $cfgDir ("accounts\" + $a.alias + "\credentials.json")
  if (Test-Path $cred) {
    if (-not (Ask "  $($a.alias) ($($a.email)) is already connected. Sign in again?")) { continue }
  }
  Write-Host ""
  Write-Host "  Signing in: $($a.alias) = $($a.email)" -ForegroundColor White
  Write-Host "  In the browser: pick $($a.email). If Google says the app isn't verified,"
  Write-Host "  click Advanced > 'Go to Career Advisor Mail', then Continue and allow access."
  & node dist\auth.js $a.alias $a.email
  if ($LASTEXITCODE -ne 0) {
    Warn "Sign-in for $($a.alias) didn't finish."
    if ($a.alias -eq 'school') { Warn "If Google said access is blocked by your organization, your school doesn't allow this app. The personal inbox still works." }
  } else { Ok "$($a.alias) connected" }
}

# ---- 5. Register with the Claude desktop app ---------------------------
Step 5 "Add to the Claude desktop app"
$candidates = @(
  (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
)
$pkg = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pkg) { $candidates += (Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json') }
$target = $candidates | Where-Object { Test-Path (Split-Path $_ -Parent) } | Select-Object -Last 1
if (-not $target) { $target = $candidates[0]; New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null }

$cfg = [pscustomobject]@{}
if (Test-Path $target) {
  Copy-Item $target ($target + '.bak') -Force
  $raw = Get-Content $target -Raw
  if ($raw.Trim()) { $cfg = $raw | ConvertFrom-Json }
}
if (-not ($cfg.PSObject.Properties.Name -contains 'mcpServers')) { $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
$entry = [pscustomobject]@{ command = $node.Source; args = @((Join-Path $here 'dist\index.js')) }
if ($cfg.mcpServers.PSObject.Properties.Name -contains 'gmail-multi') { $cfg.mcpServers.'gmail-multi' = $entry }
else { $cfg.mcpServers | Add-Member -NotePropertyName 'gmail-multi' -NotePropertyValue $entry }
$json = $cfg | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding $false))
Ok "Added 'gmail-multi' to $target (backup saved as .bak)"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  Done. Fully quit Claude (system tray > Quit) and reopen it," -ForegroundColor Green
Write-Host "  then tell Claude: 'check my Gmail connection'." -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
