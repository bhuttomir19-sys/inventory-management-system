# Tradeflow ERP — Windows / IIS deployment package

This ZIP contains the built frontend, backend, locked production dependencies, portable Node.js 24 x64 runtime, Windows service wrapper, SQL schema/migration tools, IIS proxy template and installation/update scripts. The server needs **no Git, npm, build tools or separate Node installation**. No .env, local database, company records, passwords or demo users are shipped.

## Server prerequisites (IT)

- 64-bit Windows 10 1809+/Windows 11 or Windows Server 2019+; administrator access; .NET Framework 4.8+ for WinSW.
- IIS enabled with Microsoft [URL Rewrite 2.1](https://www.iis.net/downloads/microsoft/url-rewrite) and [Application Request Routing 3.0](https://www.iis.net/downloads/microsoft/application-request-routing). Use Windows PowerShell 5.1 for the installer. IIS/ARR are Windows prerequisites, not embedded installers.
- SQL Server installed and reachable on a fixed TCP port. Create/restore the existing database first and provide a dedicated SQL-authenticated login. SQL Server 2022 is tested; use an appropriate production edition/license. SQL Server itself and your database backup are not part of this ZIP.
- A fixed server IPv4 address or DNS name, and an HTTPS certificate in **Local Computer → Personal**, with private key, matching that address. Its issuer must be trusted on the server and client computers. For IP access, the certificate must include that IP in its SAN.
- A current full native SQL Server backup before migrating or updating. The portable business JSON export excludes users and financial journals.

IT can enable IIS through Windows Features/Server Manager. For Windows Server, `Install-WindowsFeature Web-Server,Web-Mgmt-Tools` enables the base roles; install URL Rewrite/ARR separately from Microsoft. Keep the SQL port private. Do not open the Node backend port to the LAN.

## First installation

1. Copy the ZIP and its `.sha256` sidecar to the server. Verify the SHA256 with `Get-FileHash`. Obtain the expected checksum from the same trusted project delivery channel. Have IT review these unsigned scripts.
2. Right-click the downloaded ZIP → Properties → **Unblock** (if present), then extract it to a temporary installation folder, such as `C:\Install\TradeflowERP`. The package should contain Install.ps1, app/, runtime/, service/ and package-manifest.json together. A machine-enforced signing policy still applies; ask IT to sign/approve the scripts if needed.
3. Open **Windows PowerShell as Administrator**. Run, replacing the sample address, certificate thumbprint and SQL login:

```powershell
cd "C:\Install\TradeflowERP"
.\Install.cmd -Origin "https://192.168.1.50" `
  -CertificateThumbprint "YOUR_CERTIFICATE_THUMBPRINT" `
  -SqlServer "127.0.0.1" -SqlPort 1433 `
  -Database "tradeflow" -SqlUser "tradeflow" `
  -OpenFirewall
```

`Install.cmd` uses process-only RemoteSigned policy; it does not change machine/user execution policy or bypass Group Policy. It prompts securely for the SQL password; do not put it in a command line or send it in chat. Passwords with quotes, backslashes or spaces are stored correctly in protected JSON configuration.

The default installation directory is `C:\ProgramData\TradeflowERP`. It must not already exist for first install. Configuration, logs, service files, website and versioned releases are kept separately. The app binds **127.0.0.1 only** behind IIS. HTTPS cookies and exact origin checks are enforced. A dedicated Windows service SID gets read access to app/config files and write access to logs; IIS can read only the separate web folder, not SQL credentials.

`-OpenFirewall` adds an HTTPS rule for **Domain/Private profiles and LocalSubnet only**. It never opens the Node or SQL ports. Omit it if IT manages firewall rules centrally. Remote/VPN subnet access needs IT's explicit firewall configuration.

For SQL Server's local development self-signed certificate only, `-TrustSqlCertificate` opts into trusting that SQL certificate. Production should use a trusted SQL certificate whose identity matches `-SqlServer`; verification is enabled by default. This switch does **not** disable IIS/browser HTTPS verification. Node uses the Windows system CA trust as well as its normal CA roots.

### Existing database

Existing users, passwords, company branding, stock, invoices and financial books are retained. The installer never resets an existing administrator. If a legacy/schema upgrade is needed, stop **all** app writers, take a full backup and pass `-MigrateSchema -BackupConfirmed` on the initial installer command. If you omit those switches and the preflight detects an upgrade, installation stops before migrating. Database migration needs DDL privileges; IT should use an appropriate migration login and reduce runtime permissions afterward.

### New empty database

The database must already exist. With an empty database the installer asks for company name, currency, administrator email and a new password (14+ characters). It creates one administrator and company settings, **no demo products or transactions**. It refuses to create/reset an admin if business records exist without users; that is an IT recovery task. After login, verify opening balances in Finance & Accounts if you are starting financial books.

### If first installation fails

The script stops at the error and retains protected files/logs for diagnosis; it does not delete or restore SQL data. Do not blindly delete the install directory or overwrite another site/service. If a service or site was created, IT should stop/remove only the `TradeflowERP` service/site/pool, preserve `configuration`, and review the error before retrying with a fresh install directory. The included Uninstall.ps1 handles completed installations with install.json; partial installations require IT review. A committed schema migration/admin initialization is not automatically undone.

## Checks and daily operation

```powershell
.\Test-Deployment.ps1 -InstallRoot "C:\ProgramData\TradeflowERP"
Get-Service TradeflowERP
Restart-Service TradeflowERP
```

The check verifies the Windows service, SQL-backed health endpoint, origin, expected release revision, and IIS HTTPS with normal TLS verification. Open `https://192.168.1.50` from another computer on the allowed network. Sign in with your existing account (or the administrator you created). Reboot once to confirm automatic startup. Browser certificates must be trusted on every client.

- Protected configuration: `C:\ProgramData\TradeflowERP\configuration\appsettings.json`.
- Logs: `C:\ProgramData\TradeflowERP\logs` (rotated; administrator/service access).
- Backend: `http://127.0.0.1:3000` by default, never an office-facing URL.
- IIS site/application pool and Windows service: `TradeflowERP`.
- IIS site physical root: the separate `web` folder, **not** the app/config folder.

After editing protected configuration, restart the service and run the deployment check. Node runs continuously without an open console. Only one Node service instance is installed. IIS forwards API methods including PUT/DELETE; WebDAV is removed only for this site and API JSON errors pass through unchanged.

## Updates

Back up SQL Server, extract a newly built package elsewhere, then run as Administrator:

```powershell
.\Update.cmd -InstallRoot "C:\ProgramData\TradeflowERP"
```

For a required schema upgrade add `-MigrateSchema -BackupConfirmed` after stopping other writers. Update stages a new release, preserves protected configuration/data, switches the Windows service and checks local health. A failed service start restores the previous service XML and restarts the previous code. A committed **database migration is not rolled back**; IT must use the full SQL backup if the old code needs the old schema. Keep previous releases until the update is accepted. The updater does not replace IIS bindings/certificates/firewall rules.

## Uninstall hosting only

```powershell
.\Uninstall.ps1 -InstallRoot "C:\ProgramData\TradeflowERP"
```

This asks for confirmation and removes only recorded Tradeflow service/site/pool/firewall resources. It retains files, protected credentials, logs and the SQL database. It does not remove IIS, ARR, certificates or server-wide proxy settings.

## Package provenance and rebuilding

Portable Node.js is from nodejs.org and checked against its pinned official SHA256. WinSW 2.12.0 NET461 is from its official GitHub release with a pinned checksum and MIT license. `licenses/` records URLs/checksums/licenses; npm package licenses and a locked production dependency graph are in app/node_modules and app/package-lock.json. The package has a per-file SHA256 manifest plus ZIP checksum for integrity; it is not an Authenticode-signed MSI.

On the development checkout, with Node.js/npm and Internet access:

```powershell
npm.cmd ci
npm.cmd run package:windows
npm.cmd run package:verify -- "releases\YOUR-PACKAGE.zip"
```

The builder runs the frontend build, installs locked JavaScript-only backend dependencies in an isolated staging folder, downloads/verifies pinned Windows assets and writes `releases/TradeflowERP-Windows-x64-*.zip` plus `.sha256`. No build happens on the deployment server. Update asset pins only after verifying official sources/checksums. Current frontend/API behavior is tested in Linux; Windows scripts are parsed and reviewed here, but actual IIS/service installation must be validated on your Windows server. No local Windows machine or office SQL Server is accessed from the cloud build environment.

Developer checks: `npm test`, `npm run test:mssql`, and `npm run test:package` (the last two require an isolated local SQL Server test account with database creation rights). `powershell.exe -File tests/windows-installer.tests.ps1` parses installer scripts and validates XML without installing IIS/services.
