import 'dotenv/config';import{spawn}from'node:child_process';import{once}from'node:events';
// SQLCMDPASSWORD avoids exposing the password in command arguments. Local development only.
const child=spawn('docker',['compose','-f','compose.mssql.yaml','exec','-e','SQLCMDPASSWORD','mssql','/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U',process.env.MSSQL_USER,'-d',process.env.MSSQL_DATABASE,'-C'],{stdio:'inherit',env:{...process.env,SQLCMDPASSWORD:process.env.MSSQL_PASSWORD}});
child.on('error',()=>{console.error('Docker Compose is required.');process.exitCode=1;});const[code]=await once(child,'exit');process.exitCode=code||0;
