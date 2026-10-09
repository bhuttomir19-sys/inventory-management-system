import 'dotenv/config';
import {connectDatabase}from'../storage.js';import{spawn}from'node:child_process';import{once}from'node:events';
if(process.env.DB_CLIENT!=='mysql')throw Error('Configure DB_CLIENT=mysql in .env before running MySQL tests');
// Tests create a separate sibling database. Never clear or mutate the application database.
const database=process.env.MYSQL_DATABASE;if(!/^[A-Za-z0-9_]+$/.test(database||''))throw Error('Invalid MYSQL_DATABASE');
const mysql=await import('mysql2/promise');const ssl=process.env.MYSQL_SSL==='true'?{rejectUnauthorized:true,...(process.env.MYSQL_SSL_CA?{ca:readFileSync(process.env.MYSQL_SSL_CA,'utf8')}:{})}:undefined;
const localRoot=process.env.MYSQL_ROOT_PASSWORD&&['127.0.0.1','localhost'].includes(process.env.MYSQL_HOST);
const testUser=process.env.MYSQL_TEST_USER||(localRoot?'root':process.env.MYSQL_USER);const testPassword=process.env.MYSQL_TEST_PASSWORD||(localRoot?process.env.MYSQL_ROOT_PASSWORD:process.env.MYSQL_PASSWORD);
const connection=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:testUser,password:testPassword,ssl});
const testDatabase=database+'_test_'+Date.now();let child;
try{await connection.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);child=spawn(process.execPath,['--test','tests/mysql.integration.js'],{stdio:'inherit',env:{...process.env,ADMIN_PASSWORD:'Tradeflow2026!',MYSQL_DATABASE:testDatabase,MYSQL_USER:testUser,MYSQL_PASSWORD:testPassword,DB_CLIENT:'mysql'}});const[code]=await once(child,'exit');process.exitCode=code||0;}finally{await connection.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``);await connection.end();}
