# Opens the backend (localhost:4000) on the Matstack tunnel address (PUBLIC_URL).
# Needs .local\matstack-local-agent.exe. The tunnel key is read from MATSTACK_TUNNEL_KEY in .env;
# if it is empty, it is asked for once and saved there.
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root '.local\matstack-local-agent.exe'
$envFile = Join-Path $root '.env'
if (-not (Test-Path $agent)) { Write-Error "Agent not found: $agent"; exit 1 }

$lines = @(Get-Content $envFile -Encoding UTF8)
$line = $lines | Where-Object { $_ -match '^\s*MATSTACK_TUNNEL_KEY\s*=' } | Select-Object -First 1
$key = if ($line) { ($line -split '=', 2)[1].Trim() } else { '' }

if (-not $key) {
  $secure = Read-Host 'Matstack tunnel key' -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
  if (-not $key) { Write-Error 'No key given'; exit 1 }
  if ($line) {
    $lines = $lines | ForEach-Object { if ($_ -match '^\s*MATSTACK_TUNNEL_KEY\s*=') { "MATSTACK_TUNNEL_KEY=$key" } else { $_ } }
  } else {
    $lines += "MATSTACK_TUNNEL_KEY=$key"
  }
  [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
  Write-Host 'Key saved to .env'
}

& $agent --tunnel-key $key
