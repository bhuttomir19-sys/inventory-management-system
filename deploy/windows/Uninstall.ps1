#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([string]$InstallRoot='C:\ProgramData\TradeflowERP')
. (Join-Path $PSScriptRoot 'Common.ps1')
Require-Administrator
if($InstallRoot -notmatch '^[A-Za-z]:\\'){throw 'InstallRoot must be an absolute local drive path.'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$info=Get-Content (Join-Path $InstallRoot 'install.json') -Raw|ConvertFrom-Json
if($info.service -ne 'TradeflowERP' -or $info.site -ne 'TradeflowERP'){throw 'Unexpected installation identity.'}
if($PSCmdlet.ShouldProcess($InstallRoot,'Remove only the Tradeflow Windows service, IIS site/pool and its recorded firewall rule; retain files and database')){
 Import-Module WebAdministration
 Stop-Service TradeflowERP -ErrorAction SilentlyContinue
 Invoke-Native (Join-Path $InstallRoot 'service\TradeflowERP.exe') @('uninstall')
 if(Test-Path 'IIS:\Sites\TradeflowERP'){Remove-Website -Name TradeflowERP}
 if(Test-Path 'IIS:\AppPools\TradeflowERP'){Remove-WebAppPool -Name TradeflowERP}
 if($info.firewall){Remove-NetFirewallRule -Name TradeflowERP-HTTPS -ErrorAction SilentlyContinue}
 Write-Host 'Hosting removed. Application releases, protected credentials, logs and SQL Server data were retained. ARR proxy settings and certificates were not removed.'
}
