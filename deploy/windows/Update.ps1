#Requires -Version 5.1
[CmdletBinding()]
param([string]$InstallRoot='C:\ProgramData\TradeflowERP',[switch]$MigrateSchema,[switch]$BackupConfirmed)
. (Join-Path $PSScriptRoot 'Common.ps1')
Require-Administrator
if($InstallRoot -notmatch '^[A-Za-z]:\\'){throw 'InstallRoot must be an absolute local drive path.'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$package=Confirm-Package $PSScriptRoot
$info=Get-Content (Join-Path $InstallRoot 'install.json') -Raw|ConvertFrom-Json
if($info.service -ne 'TradeflowERP'){throw 'Unexpected installation identity.'}
$release=Stage-Release $PSScriptRoot $InstallRoot $package
$state=Invoke-AppCommand $InstallRoot $release '--check-db'|ConvertFrom-Json
if(($state.legacy -or $state.schemaVersion -lt $package.schemaVersion) -and (-not $MigrateSchema -or -not $BackupConfirmed)){throw 'Schema upgrade requires a full database backup, -MigrateSchema -BackupConfirmed, and all writers stopped.'}
$xmlPath=Join-Path $InstallRoot 'service\TradeflowERP.xml';$oldXml=[IO.File]::ReadAllText($xmlPath)
Stop-Service TradeflowERP
try{
 if($MigrateSchema){if(-not $BackupConfirmed){throw 'Confirm a full SQL backup first.'};Invoke-AppCommand $InstallRoot $release '--normalize'}
 [IO.File]::WriteAllText($xmlPath,(Get-ServiceXml $InstallRoot $release),[Text.UTF8Encoding]::new($false))
 Start-Service TradeflowERP;$null=Wait-LocalHealth $info.backendPort $package.commit
 $info.release=$release;$info.version=$package.version;$info.commit=$package.commit
 Write-PrivateJson (Join-Path $InstallRoot 'install.json') $info
 Write-Host 'Update healthy. Previous release files were retained; database/configuration were not replaced.'
}catch{
 Stop-Service TradeflowERP -ErrorAction SilentlyContinue
 [IO.File]::WriteAllText($xmlPath,$oldXml,[Text.UTF8Encoding]::new($false))
 Start-Service TradeflowERP
 throw 'Update failed; previous application service configuration restored. A committed database migration was NOT undone. Use the SQL backup with IT if required.'
}
