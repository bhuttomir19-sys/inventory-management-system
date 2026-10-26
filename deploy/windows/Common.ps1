Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Require-Administrator {
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Open Windows PowerShell as Administrator.'}
 if(-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Version.Build -lt 17763){throw 'Use 64-bit Windows 10 1809+, Windows 11, or Windows Server 2019+.'}
}
function Read-SecretText([string]$Prompt){
 $secret=Read-Host $Prompt -AsSecureString;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
}
function Write-PrivateJson([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
function Invoke-Native([string]$File,[string[]]$Arguments){
 & $File @Arguments
 if($LASTEXITCODE -ne 0){throw "Command failed ($LASTEXITCODE): $([IO.Path]::GetFileName($File))"}
}
function Confirm-Package([string]$PackageRoot){
 $manifest=Get-Content -LiteralPath (Join-Path $PackageRoot 'package-manifest.json') -Raw|ConvertFrom-Json
 if($manifest.platform -ne 'win32-x64'){throw 'This package is not for Windows x64.'}
 foreach($item in $manifest.files){
  $path=[IO.Path]::GetFullPath((Join-Path $PackageRoot $item.path))
  if(-not $path.StartsWith(([IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe package path.'}
  if(-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256){throw "Package checksum failed: $($item.path)"}
 }
 return $manifest
}
function Set-RootPermissions([string]$Path){
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)}
 Set-Acl -LiteralPath $Path -AclObject $acl
}
function Grant-ServicePermissions([string]$Path,[string]$ServiceId,[string]$Rights='ReadAndExecute'){
 $acl=Get-Acl -LiteralPath $Path;$rule=[Security.AccessControl.FileSystemAccessRule]::new("NT SERVICE\$ServiceId",$Rights,'ContainerInherit,ObjectInherit','None','Allow');$acl.SetAccessRule($rule);Set-Acl -LiteralPath $Path -AclObject $acl
}
function Get-ServiceXml([string]$Root,[string]$Release){
 function Escape([string]$Text){return [Security.SecurityElement]::Escape($Text)}
 $node=Escape (Join-Path $Release 'runtime\node.exe');$entry=Escape (Join-Path $Release 'app\windows-entry.mjs');$working=Escape (Join-Path $Release 'app');$config=Escape (Join-Path $Root 'configuration\appsettings.json');$logs=Escape (Join-Path $Root 'logs')
 return @"
<service>
 <id>TradeflowERP</id><name>Tradeflow ERP</name><description>Trading application behind IIS; SQL Server storage.</description>
 <executable>$node</executable><arguments>--use-system-ca &quot;$entry&quot;</arguments><workingdirectory>$working</workingdirectory>
 <env name="TRADEFLOW_CONFIG" value="$config"/><env name="NODE_ENV" value="production"/>
 <serviceaccount><username>NT AUTHORITY\LocalService</username></serviceaccount>
 <startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>
 <onfailure action="restart" delay="10 sec"/><onfailure action="restart" delay="30 sec"/><resetfailure>1 hour</resetfailure>
 <stoptimeout>20 sec</stoptimeout><logpath>$logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@
}
function Invoke-AppCommand([string]$Root,[string]$Release,[string]$Mode){
 $before=$env:TRADEFLOW_CONFIG;$env:TRADEFLOW_CONFIG=Join-Path $Root 'configuration\appsettings.json'
 try{& (Join-Path $Release 'runtime\node.exe') --use-system-ca (Join-Path $Release 'app\windows-entry.mjs') $Mode;if($LASTEXITCODE -ne 0){throw "Application command failed: $Mode"}}finally{$env:TRADEFLOW_CONFIG=$before}
}
function Wait-LocalHealth([int]$Port,[string]$ExpectedRelease=''){
 for($i=0;$i -lt 30;$i++){
  try{$result=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3;if($result.status -eq 'ok' -and $result.database -eq 'mssql' -and (-not $ExpectedRelease -or $result.release -eq $ExpectedRelease)){return $result}}catch{}
  Start-Sleep -Seconds 1
 }
 throw 'Application health check failed. Inspect the protected logs folder; database settings/schema may need IT attention.'
}
function Stage-Release([string]$PackageRoot,[string]$Root,$Manifest){
 $tag=Get-Date -Format 'yyyyMMdd-HHmmss-fff';$release=Join-Path $Root "releases\$tag"
 New-Item -ItemType Directory -Path $release -Force|Out-Null
 foreach($folder in @('app','runtime')){Copy-Item -LiteralPath (Join-Path $PackageRoot $folder) -Destination $release -Recurse}
 return $release
}
