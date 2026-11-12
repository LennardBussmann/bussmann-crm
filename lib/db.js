'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'crm.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- 'admin' | 'user'
  active INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  ical_token TEXT UNIQUE,
  notify_email INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salutation TEXT,
  first_name TEXT,
  last_name TEXT NOT NULL,
  company TEXT,
  street TEXT,
  zip TEXT,
  city TEXT,
  customer_type TEXT,                         -- Kommune | Privat | Landwirt | Forst | Gewerbe
  birthday TEXT,                              -- YYYY-MM-DD
  email TEXT,
  mobile TEXT,
  phone TEXT,
  visit_interval TEXT NOT NULL DEFAULT '',    -- '' | monthly | quarterly | halfyearly | yearly
  info TEXT NOT NULL DEFAULT '',              -- Infofeld (immer oben)
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(last_name, first_name);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- besuch | telefonat | email | notiz | termin | sonstiges | system
  happened_at TEXT NOT NULL,                  -- YYYY-MM-DDTHH:MM
  text TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_customer ON entries(customer_id, happened_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'aufgabe',       -- anruf | termin | besuch | angebot | aufgabe
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,                     -- YYYY-MM-DD
  due_time TEXT,                              -- HH:MM or NULL (ganztägig)
  duration_min INTEGER NOT NULL DEFAULT 60,
  location TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open | done
  done_at TEXT,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_note TEXT,
  remind_day_before INTEGER NOT NULL DEFAULT 1,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  auto_visit INTEGER NOT NULL DEFAULT 0,      -- 1 = automatisch aus Besuchsintervall
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

function get(sql, ...p) { return db.prepare(sql).get(...p); }
function all(sql, ...p) { return db.prepare(sql).all(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- Migrationen (bestehende Datenbanken erweitern) ----------
const hasCol = (t, c) => all(`PRAGMA table_info(${t})`).some((r) => r.name === c);
if (!hasCol('customers', 'is_buyer')) db.exec('ALTER TABLE customers ADD COLUMN is_buyer INTEGER NOT NULL DEFAULT 0');
if (!hasCol('customers', 'tags')) db.exec("ALTER TABLE customers ADD COLUMN tags TEXT DEFAULT ''");
if (!hasCol('customers', 'lat')) db.exec('ALTER TABLE customers ADD COLUMN lat REAL; ALTER TABLE customers ADD COLUMN lng REAL;');
if (!hasCol('customers', 'geo_status')) db.exec("ALTER TABLE customers ADD COLUMN geo_status TEXT DEFAULT ''"); // '' offen | ok | approx | fail | manual
db.exec(`
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category TEXT,
  brand TEXT,
  model TEXT,
  serial TEXT,
  year INTEGER,
  purchase_date TEXT,
  sold_by_us INTEGER NOT NULL DEFAULT 0,
  service_interval TEXT NOT NULL DEFAULT '',
  last_service TEXT,
  next_service TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_machines_customer ON machines(customer_id);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'urlaub',        -- urlaub | privat | krank | schulung | sonstiges
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT,                            -- NULL = ganztägig
  end_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_absences_range ON absences(start_date, end_date);
`);
if (!hasCol('tasks', 'machine_id')) db.exec('ALTER TABLE tasks ADD COLUMN machine_id INTEGER REFERENCES machines(id) ON DELETE CASCADE');
db.exec(`
CREATE TABLE IF NOT EXISTS task_participants (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_participants_user ON task_participants(user_id);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'verkauf',        -- verkauf | einkauf
  date TEXT NOT NULL,                          -- YYYY-MM-DD (Verkaufs- bzw. Einkaufsdatum)
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- Verkäufer / Einkäufer
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  party TEXT NOT NULL DEFAULT '',              -- Kunde/Lieferant als Freitext (wenn nicht im CRM)
  condition TEXT NOT NULL DEFAULT 'neu',       -- neu | gebraucht | vorfuehr
  category TEXT, brand TEXT, model TEXT, serial TEXT, year INTEGER,
  purchase_price REAL,                         -- EK netto
  sale_price REAL,                             -- VK netto (nur Verkauf)
  extra_costs REAL NOT NULL DEFAULT 0,         -- Nebenkosten (Überführung, Aufbereitung, Provision …)
  purchase_id INTEGER REFERENCES sales(id) ON DELETE SET NULL, -- Verkauf aus eigenem Einkauf/Lager
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS used_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT, brand TEXT, model TEXT, serial TEXT, year INTEGER, hours INTEGER,
  condition TEXT NOT NULL DEFAULT 'gebraucht',          -- gebraucht | vorfuehr
  equipment TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  purchase_price REAL, asking_price REAL, location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'verfuegbar',           -- verfuegbar | reserviert | verkauft
  in_date TEXT NOT NULL, sold_date TEXT,
  origin TEXT NOT NULL DEFAULT '',                     -- Herkunft, z. B. Inzahlungnahme von …
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,   -- Vorbesitzer
  purchase_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,       -- Einkauf
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,           -- Verkauf
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS used_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  used_id INTEGER NOT NULL REFERENCES used_machines(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL, mime TEXT, sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  kunde TEXT NOT NULL DEFAULT '', telefon TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  max_price REAL, min_year INTEGER, max_hours INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offen',                -- offen | erledigt
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS search_hits (
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  used_id INTEGER NOT NULL REFERENCES used_machines(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (search_id, used_id)
);
CREATE INDEX IF NOT EXISTS idx_used_status ON used_machines(status);
CREATE TABLE IF NOT EXISTS tours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stops TEXT NOT NULL DEFAULT '[]',          -- JSON-Liste von Kunden-IDs in Fahrreihenfolge
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tours_user ON tours(user_id);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  kunde TEXT NOT NULL DEFAULT '', ort TEXT NOT NULL DEFAULT '',      -- nur wenn Kunde (noch) nicht im CRM
  ansprech TEXT NOT NULL DEFAULT '', telefon TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  typ TEXT NOT NULL DEFAULT '', modell TEXT NOT NULL DEFAULT '', ausstattung TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Lead / Interesse',
  preis REAL, angebot_vom TEXT, finanzierung TEXT NOT NULL DEFAULT 'Offen',
  inzahlung TEXT NOT NULL DEFAULT '', inz_wert REAL,
  naechster TEXT NOT NULL DEFAULT '', faellig TEXT, abschluss TEXT, liefer TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,          -- Verkäufer
  notizen TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
`);
if (!hasCol('sales', 'project_id')) db.exec('ALTER TABLE sales ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
if (!hasCol('projects', 'offer_stored')) db.exec("ALTER TABLE projects ADD COLUMN offer_stored TEXT; ALTER TABLE projects ADD COLUMN offer_name TEXT; ALTER TABLE projects ADD COLUMN offer_mime TEXT;");
if (!hasCol('projects', 'used_id')) db.exec('ALTER TABLE projects ADD COLUMN used_id INTEGER REFERENCES used_machines(id) ON DELETE SET NULL');
if (!hasCol('searches', 'project_id')) db.exec('ALTER TABLE searches ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
if (!hasCol('notifications', 'link')) db.exec('ALTER TABLE notifications ADD COLUMN link TEXT');
if (!hasCol('tasks', 'project_id')) db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE');

function getSetting(key, def = '') {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value == null ? '' : String(value));
}

// Einmalig (Nov. 2026): alle Kunden mit Maschine sind kaufende Kunden
if (!db.prepare("SELECT 1 FROM settings WHERE key='mig_buyer_machines'").get()) {
  db.exec("UPDATE customers SET is_buyer=1 WHERE id IN (SELECT customer_id FROM machines)");
  db.prepare("INSERT INTO settings(key, value) VALUES('mig_buyer_machines', '1')").run();
}

module.exports = { db, get, all, run, tx, getSetting, setSetting, DATA_DIR };
