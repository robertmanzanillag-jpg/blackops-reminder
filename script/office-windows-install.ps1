param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
function Quote-TaskArgument([string]$Value) {
  if ($Value -match '["\r\n]' -or $Value.EndsWith('\')) { throw 'Unsafe task argument' }
  return '"' + $Value + '"'
}
try {
  foreach ($key in @('NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')) {
    if ([Environment]::GetEnvironmentVariable($key)) { throw 'Unsafe inherited Node environment' }
  }
  foreach ($key in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGOPTIONS','PGSERVICE','PGSERVICEFILE')) { [Environment]::SetEnvironmentVariable($key,$null,'Process') }
  foreach ($candidate in @($NodePath,$RepoPath,$ConfigPath)) { if (-not [IO.Path]::IsPathRooted($candidate)) { throw 'Absolute paths required' } }
  $node = (Resolve-Path -LiteralPath $NodePath).Path
  $repo = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\')
  $config = (Resolve-Path -LiteralPath $ConfigPath).Path
  $configSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($rule in (Get-Acl -LiteralPath $config).Access) {
    $identity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $identity -notin @($configSid,'S-1-5-18','S-1-5-32-544')) { throw 'Configuration ACL is not private' }
  }
  if ([IO.Path]::GetFileName($node) -ine 'node.exe') { throw 'node.exe required' }
  $launcher = Join-Path $repo 'script\office-windows-launch.ps1'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Reviewed launcher missing' }
  $entry = Join-Path $repo 'script\office-windows-worker.mjs'
  & $node $entry --repo $repo --config $config --preflight
  if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; no task registered' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $identity.User.Value
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $suffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes("$sid|$repo|$config")))).Replace('-','').Substring(0,16) }
  finally { $hash.Dispose() }
  $taskName = "BlackOpsOfficeReviewer-$suffix"
  $marker = "BlackOps Office Reviewer managed task v1 $suffix"
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File ' + (Quote-TaskArgument $launcher) + ' -NodePath ' + (Quote-TaskArgument $node) + ' -RepoPath ' + (Quote-TaskArgument $repo) + ' -ConfigPath ' + (Quote-TaskArgument $config)
  $existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Description -cne $marker -or $existing.Principal.UserId -ne $sid -or $existing.Actions.Count -ne 1 -or $existing.Actions[0].Execute -ine $powershell -or $existing.Actions[0].Arguments -cne $arguments -or $existing.Actions[0].WorkingDirectory -ine $repo) { throw 'Existing task ownership mismatch; refusing overwrite' }
    if ([int]$existing.Principal.RunLevel -ne 0 -or [int]$existing.Principal.LogonType -ne 3 -or [int]$existing.Settings.MultipleInstances -ne 2 -or -not $existing.Settings.Hidden -or $existing.Settings.ExecutionTimeLimit -ne 'PT0S' -or -not $existing.Settings.StartWhenAvailable -or $existing.Settings.DisallowStartIfOnBatteries -or $existing.Settings.StopIfGoingOnBatteries) { throw 'Existing task safety settings mismatch' }
    $logonTriggers = @($existing.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
    $timeTriggers = @($existing.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' })
    if ($existing.Triggers.Count -ne 2 -or $logonTriggers.Count -ne 1 -or $timeTriggers.Count -ne 1 -or $logonTriggers[0].UserId -ne $sid -or -not $logonTriggers[0].Enabled -or -not $timeTriggers[0].Enabled -or $timeTriggers[0].Repetition.Interval -ne 'PT5M' -or $timeTriggers[0].Repetition.Duration) { throw 'Existing task trigger mismatch' }
    Write-Output 'Exact owned task already exists; no overwrite performed.'
    exit 0
  }
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $repo
  $login = New-ScheduledTaskTrigger -AtLogOn -User $sid
  $recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  if (-not $Apply) { Write-Output "Validated dry run: $taskName; current user; hidden; logon and five-minute recovery; single instance. Use -Apply only after review."; exit 0 }
  # No Force: a task created concurrently cannot be overwritten.
  Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger @($login,$recovery) -Principal $principal -Settings $settings -Description $marker | Out-Null
  Write-Output "Registered $taskName. No immediate execution was requested."
} catch { Write-Error 'Office task registration refused. Check reviewed paths, configuration, database owner/schema and task ownership. No credentials are logged.'; exit 1 }
