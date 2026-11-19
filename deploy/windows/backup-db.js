// Erzeugt eine konsistente Kopie der Datenbank (auch waehrend das CRM laeuft)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const out = path.join(dir, 'backup.sqlite');
fs.rmSync(out, { force: true });
new DatabaseSync(path.join(dir, 'crm.sqlite')).exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
