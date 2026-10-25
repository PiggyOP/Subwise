import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=resolve(process.argv[2]||'data/backups');mkdirSync(directory,{recursive:true,mode:0o700});
const output=resolve(directory,'subwise-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/subwise.sqlite');
db.prepare('VACUUM INTO ?').run(output);db.close();console.log('Consistent backup saved:',output);
