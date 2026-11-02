'use strict';
const XLSX = require('xlsx');
const U = require('./util');

// Spaltenüberschriften (klein, ohne Sonderzeichen) -> Feld. Enthält auch Zoho-Bigin-Exportnamen.
const ALIASES = {
  salutation: ['anrede', 'salutation'],
  first_name: ['vorname', 'firstname', 'first name'],
  last_name: ['nachname', 'name', 'lastname', 'last name', 'familienname'],
  company: ['firma', 'firmenname', 'firma name', 'unternehmen', 'company', 'account name', 'company name'],
  street: ['strasse', 'straße', 'strasse hausnummer', 'straße hausnummer', 'straße und hausnummer', 'strasse und hausnummer', 'strasse nr', 'straße nr', 'adresse', 'anschrift', 'postadresse straße', 'postadresse strasse', 'mailing street', 'street'],
  zip: ['plz', 'postleitzahl', 'postadresse plz', 'mailing zip', 'zip', 'zip code'],
  city: ['ort', 'stadt', 'wohnort', 'postadresse stadt', 'mailing city', 'city'],
  customer_type: ['kundenart', 'kundentyp', 'art', 'typ', 'kategorie', 'type'],
  birthday: ['geburtsdatum', 'geburtstag', 'date of birth', 'birthday'],
  email: ['email', 'e-mail', 'mail', 'e-mail-adresse', 'emailadresse'],
  mobile: ['handy', 'handynummer', 'mobil', 'mobilnummer', 'mobiltelefon', 'mobile'],
  phone: ['festnetz', 'festnetznummer', 'telefon', 'tel', 'tel.', 'telefonnummer', 'phone'],
  visit_interval: ['besuchsintervall', 'intervall', 'besuch'],
  info: ['info', 'infos', 'notiz', 'notizen', 'bemerkung', 'bemerkungen', 'beschreibung', 'description'],
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim();
const LOOKUP = {};
for (const [field, list] of Object.entries(ALIASES)) for (const a of list) LOOKUP[norm(a)] = field;

function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return U.fmtDate(v);
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${U.pad(d.m)}-${U.pad(d.d)}` : null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return `${y}-${U.pad(m[2])}-${U.pad(m[1])}`; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${U.pad(m[2])}-${U.pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // US-Format aus Zoho
  if (m) return `${m[3]}-${U.pad(m[1])}-${U.pad(m[2])}`;
  return null;
}
function toType(v) {
  const s = norm(v);
  if (!s) return null;
  const hit = U.CUSTOMER_TYPES.find((t) => s.startsWith(t.toLowerCase().slice(0, 4)));
  if (hit) return hit;
  if (/gemeinde|stadt|kreis|amt/.test(s)) return 'Kommune';
  if (/landw|bauer|hof/.test(s)) return 'Landwirt';
  if (/wald|forst/.test(s)) return 'Forst';
  if (/firma|gmbh|unternehm|betrieb/.test(s)) return 'Gewerbe';
  return null;
}
function toInterval(v) {
  const s = norm(v);
  if (!s) return '';
  if (s.startsWith('monat')) return 'monthly';
  if (s.startsWith('viertel') || s.startsWith('quartal')) return 'quarterly';
  if (s.startsWith('halb')) return 'halfyearly';
  if (s.startsWith('jähr') || s.startsWith('jaehr') || s.startsWith('jahr')) return 'yearly';
  return '';
}
const phone = (v) => (v == null ? null : U.str(typeof v === 'number' ? '0' + v : v, 60));

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  // Kopfzeile = erste Zeile mit mind. 2 erkannten Spalten
  let headerIdx = rows.findIndex((r) => r.filter((h) => LOOKUP[norm(h)]).length >= 2);
  if (headerIdx < 0) throw new Error('Keine passende Kopfzeile gefunden. Bitte die Vorlage verwenden (Vorname, Nachname, Straße, PLZ, Ort …).');
  const header = rows[headerIdx];
  const map = header.map((h) => LOOKUP[norm(h)] || null);
  const mapping = header.map((h, i) => ({ column: String(h), field: map[i] })).filter((m) => m.column);
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.some((v) => String(v).trim() !== '')) continue;
    const o = {};
    r.forEach((v, i) => { const f = map[i]; if (f && o[f] == null && String(v).trim() !== '') o[f] = v; });
    // "Name" mit Vor- und Nachname in einer Spalte
    if (!o.first_name && o.last_name && !header.some((h) => LOOKUP[norm(h)] === 'first_name') && String(o.last_name).includes(' ')) {
      const parts = String(o.last_name).trim().split(/\s+/); o.last_name = parts.pop(); o.first_name = parts.join(' ');
    }
    const c = {
      salutation: U.str(o.salutation, 30), first_name: U.str(o.first_name, 100), last_name: U.str(o.last_name, 100),
      company: U.str(o.company, 200), street: U.str(o.street, 200), zip: o.zip != null ? U.str(/^\d{4}$/.test(String(o.zip).trim()) ? '0' + String(o.zip).trim() : o.zip, 10) : null,
      city: U.str(o.city, 100), customer_type: toType(o.customer_type), birthday: toDate(o.birthday),
      email: U.str(o.email, 200), mobile: phone(o.mobile), phone: phone(o.phone), visit_interval: toInterval(o.visit_interval), info: U.str(o.info, 5000) || '',
    };
    if (!c.last_name && c.company) c.last_name = c.company;
    c._error = c.last_name ? null : 'Nachname fehlt';
    out.push(c);
  }
  return { rows: out, mapping };
}

function template() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall', 'Info'],
    ['Herr', 'Max', 'Mustermann', '', 'Hauptstraße 1', '48727', 'Billerbeck', 'Landwirt', '19.07.1975', 'max@example.de', '0151 1234567', '02543 12345', 'Vierteljährlich', 'Hat 2 Rasentraktoren'],
  ]);
  ws['!cols'] = [8, 14, 16, 18, 26, 8, 16, 12, 13, 24, 16, 16, 16, 30].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Kunden');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportCustomers(list) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Kundennr.', 'Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall', 'Info', 'Betreuer', 'Angelegt am'],
    ...list.map((c) => [c.id, c.salutation, c.first_name, c.last_name, c.company, c.street, c.zip, c.city, c.customer_type,
      c.birthday ? c.birthday.split('-').reverse().join('.') : '', c.email, c.mobile, c.phone, U.INTERVAL_LABEL[c.visit_interval] || '', c.info, c.owner_name, c.created_at]),
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Kunden');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseWorkbook, template, exportCustomers };
