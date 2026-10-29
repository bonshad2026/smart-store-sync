# Asks for a value (hidden while typing) and saves it as NAME=value in the root .env,
# so secrets never have to be typed into a command line.
# Usage: powershell -ExecutionPolicy Bypass -File .\tools\set-env.ps1 INSTAGRAM_APP_SECRET
param([Parameter(Mandatory = $true)][string]$Name)
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

$secure = Read-Host $Name -AsSecureString
$value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
if (-not $value) { Write-Error 'No value given'; exit 1 }

$lines = @(Get-Content $envFile -Encoding UTF8)
$pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
if ($lines | Where-Object { $_ -match $pattern }) {
  $lines = $lines | ForEach-Object { if ($_ -match $pattern) { "$Name=$value" } else { $_ } }
} else {
  $lines += "$Name=$value"
}
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Write-Host "$Name saved to .env"
