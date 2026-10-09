import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
export function hashPassword(p) { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(p,salt,64).toString('hex'); }
export function verifyPassword(p,h) { const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex')); }
export function openDB(file='data/tradeflow.sqlite') {
 if(file!==':memory:') mkdirSync('data',{recursive:true});
 const db=new DatabaseSync(file); db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS vendors(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, productId INTEGER NOT NULL REFERENCES products(id), date TEXT NOT NULL, quantity REAL NOT NULL, reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, userId INTEGER REFERENCES users(id), expires INTEGER NOT NULL, duration INTEGER NOT NULL DEFAULT 86400000);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, date TEXT, actor TEXT, action TEXT, details TEXT);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);`);
 if(!db.prepare("PRAGMA table_info(sessions)").all().some(column=>column.name==='duration'))db.exec("ALTER TABLE sessions ADD COLUMN duration INTEGER NOT NULL DEFAULT 86400000");
 return db;
}
