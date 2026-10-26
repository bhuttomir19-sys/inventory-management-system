$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '../deploy/windows'
$failures=@()
foreach($file in Get-ChildItem -LiteralPath $root -Filter '*.ps1'){
 $tokens=$null;$errors=$null
 $null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 foreach($error in $errors){$failures+=($file.Name+': '+$error.Message+' line '+$error.Extent.StartLineNumber)}
}
if($failures.Count){$failures|Write-Output;exit 1}
. (Join-Path $root 'Common.ps1')
$base=Join-Path ([IO.Path]::GetTempPath()) 'Tradeflow & Company';$release=Join-Path ([IO.Path]::GetTempPath()) 'Release 1'
[xml]$service=Get-ServiceXml $base $release
if($service.service.id -ne 'TradeflowERP' -or $service.service.arguments -notlike '*--use-system-ca*' -or $service.service.env[0].value -notlike '*appsettings.json'){throw 'Service XML contract failed'}
[xml]$web=(Get-Content -LiteralPath (Join-Path $root 'web.config.template') -Raw).Replace('__PORT__','3000')
if($web.configuration.'system.webServer'.rewrite.rules.rule.action.url -ne 'http://127.0.0.1:3000/{R:1}'){throw 'IIS proxy configuration failed'}
Write-Output 'PASS: all PowerShell scripts parsed; escaped Windows service XML and IIS proxy XML validated.'
