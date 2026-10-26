#Requires -Version 5.1
param([string]$InstallRoot='C:\ProgramData\TradeflowERP')
. (Join-Path $PSScriptRoot 'Common.ps1')
Require-Administrator
if($InstallRoot -notmatch '^[A-Za-z]:\\'){throw 'InstallRoot must be an absolute local drive path.'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$info=Get-Content (Join-Path $InstallRoot 'install.json') -Raw|ConvertFrom-Json
if((Get-Service $info.service).Status -ne 'Running'){throw 'Tradeflow Windows service is not running.'}
$result=Wait-LocalHealth $info.backendPort $info.commit
if($result.publicOrigins -notcontains $info.origin){throw 'The application origin does not match IIS.'}
# Standard TLS verification stays enabled. The certificate must match the IP/DNS name and be trusted.
$public=Invoke-RestMethod -Uri ($info.origin+'/api/health') -TimeoutSec 15
if($public.status -ne 'ok' -or $public.database -ne 'mssql' -or $public.release -ne $info.commit){throw 'IIS did not reach the expected SQL Server application.'}
Write-Host 'PASS: Windows service, SQL Server health, origin and IIS HTTPS.'
Write-Host ('Website: '+$info.origin)
Write-Host ('Logs: '+(Join-Path $InstallRoot 'logs'))
