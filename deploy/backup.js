// Erzeugt eine konsistente Kopie der Datenbank (läuft im Container)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
fs.rmSync('/data/backup.sqlite', { force: true });
new DatabaseSync('/data/crm.sqlite').exec("VACUUM INTO '/data/backup.sqlite'");
