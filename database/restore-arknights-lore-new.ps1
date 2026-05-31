param(
  [string]$HostName = $(if ($env:PGHOST) { $env:PGHOST } else { "127.0.0.1" }),
  [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
  [string]$User = $(if ($env:PGUSER) { $env:PGUSER } else { "postgres" }),
  [string]$Database = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { "arknights_lore_new" }),
  [string]$DumpPath = "$PSScriptRoot\arknights_lore_new.current.dump"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DumpPath)) {
  throw "Dump file not found: $DumpPath"
}

$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$pgRestore = "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe"

if (-not (Test-Path -LiteralPath $psql)) {
  $psql = "psql"
}
if (-not (Test-Path -LiteralPath $pgRestore)) {
  $pgRestore = "pg_restore"
}

Write-Host "Recreating database $Database on ${HostName}:$Port ..."
& $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Database' AND pid <> pg_backend_pid();"
& $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $Database;"
& $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $Database WITH ENCODING 'UTF8';"

Write-Host "Restoring $DumpPath ..."
& $pgRestore -h $HostName -p $Port -U $User -d $Database --no-owner --no-privileges $DumpPath

Write-Host "Done. Restored $Database."
