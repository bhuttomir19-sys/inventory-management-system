#Requires -Version 5.1
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Origin,
 [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
 [Parameter(Mandatory=$true)][string]$SqlServer,
 [Parameter(Mandatory=$true)][string]$Database,
 [Parameter(Mandatory=$true)][string]$SqlUser,
 [int]$SqlPort=1433,[int]$BackendPort=3000,
 [string]$InstallRoot='C:\ProgramData\TradeflowERP',
 [switch]$TrustSqlCertificate,[switch]$MigrateSchema,[switch]$BackupConfirmed,[switch]$OpenFirewall
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Require-Administrator
if($InstallRoot -notmatch '^[A-Za-z]:\\'){throw 'InstallRoot must be an absolute local drive path.'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$package=Confirm-Package $PSScriptRoot
Import-Module WebAdministration -ErrorAction Stop
if(-not (Get-WebGlobalModule|Where-Object Name -eq 'RewriteModule')){throw 'Install Microsoft IIS URL Rewrite 2.1 before continuing. See README-FIRST.md.'}
try{$null=Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled}catch{throw 'Install Microsoft Application Request Routing (ARR) 3.0 before continuing.'}
$framework=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release).Release
if($framework -lt 528040){throw 'Install .NET Framework 4.8 or later for the Windows service wrapper.'}
$uri=[Uri]$Origin
if(-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo){throw 'Origin must be an HTTPS address without a path.'}
$Origin=$uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
if($BackendPort -lt 1024 -or $BackendPort -gt 65535 -or $SqlPort -lt 1 -or $SqlPort -gt 65535){throw 'Use a backend port in 1024–65535 and a valid SQL TCP port.'}
if(Get-Service -Name TradeflowERP -ErrorAction SilentlyContinue){throw 'TradeflowERP is already installed. Use Update.ps1.'}
if(Test-Path -LiteralPath $InstallRoot){throw 'InstallRoot already exists. Use Update.ps1 for an installed app, or review/remove files from a failed installation before retrying. Do not delete a database.'}
if((Test-Path 'IIS:\Sites\TradeflowERP') -or (Test-Path 'IIS:\AppPools\TradeflowERP')){throw 'An IIS site/pool named TradeflowERP already exists; choose an installation strategy with IT.'}
if(Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue){throw 'The selected private backend port is already in use.'}
$thumb=($CertificateThumbprint -replace '\s','')
$cert=Get-Item "Cert:\LocalMachine\My\$thumb" -ErrorAction Stop
if(-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)){throw 'Use a valid server certificate with a private key in LocalMachine\My.'}
$address=$null;$isIp=[Net.IPAddress]::TryParse($uri.DnsSafeHost,[ref]$address)
if($isIp -and $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){throw 'This installer supports IPv4 or a DNS hostname for IIS bindings.'}
$bindingIp='*';$hostHeader=$uri.DnsSafeHost;$sni=1
if($isIp){$bindingIp=$uri.DnsSafeHost;$hostHeader='';$sni=0;if(-not(Get-NetIPAddress -IPAddress $bindingIp -ErrorAction SilentlyContinue)){throw 'The HTTPS IP is not assigned to this server.'}}
foreach($binding in Get-WebBinding -Protocol https){
 $parts=$binding.bindingInformation -split ':'
 if($parts.Count -ge 3 -and [int]$parts[-2] -eq $uri.Port){
  $existingHost=$parts[-1];$existingIp=$parts[0]
  if(($isIp -and -not $existingHost -and $existingIp -in @('*','0.0.0.0',$bindingIp)) -or (-not $isIp -and $existingHost -eq $hostHeader)){throw 'An existing IIS HTTPS binding conflicts with this address. Ask IT to resolve it; no binding was overwritten.'}
 }
}
New-Item -ItemType Directory -Path $InstallRoot|Out-Null
Set-RootPermissions $InstallRoot
foreach($folder in @('configuration','logs','service','web','releases')){New-Item -ItemType Directory -Path (Join-Path $InstallRoot $folder)|Out-Null}
$config=@{APP_ORIGIN=$Origin;PORT="$BackendPort";MSSQL_HOST=$SqlServer;MSSQL_PORT="$SqlPort";MSSQL_DATABASE=$Database;MSSQL_USER=$SqlUser;MSSQL_PASSWORD=(Read-SecretText 'SQL application login password');MSSQL_TRUST_SERVER_CERTIFICATE=$TrustSqlCertificate.IsPresent.ToString().ToLowerInvariant()}
Write-PrivateJson (Join-Path $InstallRoot 'configuration\appsettings.json') $config
$config.MSSQL_PASSWORD=$null
$release=Stage-Release $PSScriptRoot $InstallRoot $package
$state=Invoke-AppCommand $InstallRoot $release '--check-db'|ConvertFrom-Json
if($state.legacy -or ($state.schemaVersion -lt $package.schemaVersion -and $state.businessRecords -gt 0)){
 if(-not $MigrateSchema -or -not $BackupConfirmed){throw 'Existing schema needs migration. Take a full SQL Server backup, stop all writers, then rerun with -MigrateSchema -BackupConfirmed (after reviewing this failed installation folder with IT).'}
 Invoke-AppCommand $InstallRoot $release '--normalize'
 $state=Invoke-AppCommand $InstallRoot $release '--check-db'|ConvertFrom-Json
}
if($state.users -eq 0){
 if($state.businessRecords -gt 0){throw 'Company records exist without users. Ask IT to recover administrator access.'}
 $company=Read-Host 'Company name';$email=Read-Host 'New administrator email';$currency=(Read-Host 'Three-letter currency code, e.g. PKR').ToUpperInvariant();$password=Read-SecretText 'New administrator password (14+ characters)';$confirmation=Read-SecretText 'Confirm administrator password'
 if($password -cne $confirmation){throw 'Administrator passwords do not match.'}
 $payload=@{company=$company;email=$email;currency=$currency;password=$password}|ConvertTo-Json -Compress
 $oldOutput=$OutputEncoding;$before=$env:TRADEFLOW_CONFIG;$env:TRADEFLOW_CONFIG=Join-Path $InstallRoot 'configuration\appsettings.json'
 try{$OutputEncoding=[Text.UTF8Encoding]::new($false);$payload|& (Join-Path $release 'runtime\node.exe') --use-system-ca (Join-Path $release 'app\windows-entry.mjs') --create-admin;if($LASTEXITCODE -ne 0){throw 'Administrator initialization failed.'}}finally{$OutputEncoding=$oldOutput;$env:TRADEFLOW_CONFIG=$before;$payload=$null;$password=$null;$confirmation=$null}
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'service\WinSW.exe') -Destination (Join-Path $InstallRoot 'service\TradeflowERP.exe')
[IO.File]::WriteAllText((Join-Path $InstallRoot 'service\TradeflowERP.xml'),(Get-ServiceXml $InstallRoot $release),[Text.UTF8Encoding]::new($false))
Invoke-Native (Join-Path $InstallRoot 'service\TradeflowERP.exe') @('install')
Invoke-Native 'sc.exe' @('sidtype','TradeflowERP','unrestricted')
Grant-ServicePermissions $InstallRoot 'TradeflowERP'
Grant-ServicePermissions (Join-Path $InstallRoot 'logs') 'TradeflowERP' 'Modify'
Start-Service TradeflowERP
$null=Wait-LocalHealth $BackendPort $package.commit
New-WebAppPool -Name TradeflowERP|Out-Null
Set-ItemProperty 'IIS:\AppPools\TradeflowERP' -Name managedRuntimeVersion -Value ''
New-Website -Name TradeflowERP -PhysicalPath (Join-Path $InstallRoot 'web') -ApplicationPool TradeflowERP -IPAddress $bindingIp -Port $uri.Port -HostHeader $hostHeader -Ssl|Out-Null
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "system.applicationHost/sites/site[@name='TradeflowERP']/bindings/binding[@protocol='https']" -Name sslFlags -Value $sni
(Get-WebBinding -Name TradeflowERP -Protocol https).AddSslCertificate($thumb,'My')
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location TradeflowERP -Filter 'system.webServer/security/authentication/anonymousAuthentication' -Name enabled -Value $true
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location TradeflowERP -Filter 'system.webServer/security/authentication/anonymousAuthentication' -Name userName -Value ''
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value $true
$webConfig=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'web.config.template') -Raw).Replace('__PORT__',"$BackendPort")
[IO.File]::WriteAllText((Join-Path $InstallRoot 'web\web.config'),$webConfig,[Text.UTF8Encoding]::new($false))
$webAcl=Get-Acl (Join-Path $InstallRoot 'web');$webAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('IIS AppPool\TradeflowERP','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'));Set-Acl (Join-Path $InstallRoot 'web') $webAcl
$rootAcl=Get-Acl $InstallRoot;$rootAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('IIS AppPool\TradeflowERP','Traverse','Allow'));Set-Acl $InstallRoot $rootAcl
if($OpenFirewall){New-NetFirewallRule -Name TradeflowERP-HTTPS -DisplayName 'Tradeflow ERP HTTPS (office subnet)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $uri.Port -RemoteAddress LocalSubnet -Profile Domain,Private|Out-Null}
Write-PrivateJson (Join-Path $InstallRoot 'install.json') @{service='TradeflowERP';site='TradeflowERP';origin=$Origin;backendPort=$BackendPort;release=$release;version=$package.version;commit=$package.commit;firewall=$OpenFirewall.IsPresent}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Common.ps1') -Destination $InstallRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Test-Deployment.ps1') -Destination $InstallRoot
& (Join-Path $InstallRoot 'Test-Deployment.ps1') -InstallRoot $InstallRoot
Write-Host "Installed. Open $Origin on a computer that trusts the HTTPS certificate."
