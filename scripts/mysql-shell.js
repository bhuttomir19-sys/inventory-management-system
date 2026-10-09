import{spawn}from'node:child_process';import{once}from'node:events';
const child=spawn('docker',['compose','exec','mysql','sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"'],{stdio:'inherit'});child.on('error',()=>{console.error('Docker Compose is required.');process.exitCode=1;});const[code]=await once(child,'exit');process.exitCode=code||0;
