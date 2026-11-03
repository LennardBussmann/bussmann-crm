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
  is_buyer: ['status', 'kundenstatus', 'kaufender kunde', 'käufer', 'kaeufer'],
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
  if (/garten|gala|baumsch|gärtn|gaertn|landschaftsb/.test(s)) return 'Gartenbau';
  if (/wald|forst/.test(s)) return 'Forst';
  if (/firma|gmbh|unternehm|betrieb/.test(s)) return 'Gewerbe';
  return null;
}
function toBuyer(v) {
  const s = norm(v);
  if (!s || /interess|nein|^no?$|^0$|^-$|lead|potenz/.test(s)) return 0;
  return /kunde|käuf|kaeuf|^ja|^x$|^1$|true|yes|stamm/.test(s) ? 1 : 0;
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

// CSV/Text: Kodierung erkennen (UTF-8 oder Windows-1252, wie Excel unter Windows speichert)
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
function isBinarySheet(buf) {
  return (buf[0] === 0x50 && buf[1] === 0x4b) // xlsx/ods (ZIP)
    || (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0); // xls
}

function parseWorkbook(buf) {
  let wb;
  if (isBinarySheet(buf)) {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
  } else {
    let text = decodeText(buf);
    const first = text.split(/\r?\n/, 1)[0] || '';
    const count = (ch) => first.split(ch).length - 1;
    const FS = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
    // Datumswerte und PLZ als Text belassen; Parsing übernimmt toDate()/zip-Logik
    wb = XLSX.read(text, { type: 'string', FS, raw: true, cellDates: false });
  }
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
      email: U.str(o.email, 200), mobile: phone(o.mobile), phone: phone(o.phone), visit_interval: toInterval(o.visit_interval), is_buyer: toBuyer(o.is_buyer), info: U.str(o.info, 5000) || '',
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
    ['Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Status', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall', 'Info'],
    ['Herr', 'Max', 'Mustermann', '', 'Hauptstraße 1', '48727', 'Billerbeck', 'Landwirt', 'Kunde', '19.07.1975', 'max@example.de', '0151 1234567', '02543 12345', 'Vierteljährlich', 'Hat 2 Rasentraktoren'],
    ['Frau', 'Anna', 'Beispiel', 'Gartenbau Beispiel', 'Dorfstraße 5', '48727', 'Billerbeck', 'Gartenbau', 'Interessent', '', '', '0170 7654321', '', '', 'Interesse an Aufsitzmäher'],
  ]);
  ws['!cols'] = [8, 14, 16, 18, 26, 8, 16, 12, 11, 13, 24, 16, 16, 16, 30].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Kunden');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportCustomers(list) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Kundennr.', 'Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Status', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall', 'Info', 'Betreuer', 'Letzter Kontakt', 'Angelegt am'],
    ...list.map((c) => [c.id, c.salutation, c.first_name, c.last_name, c.company, c.street, c.zip, c.city, c.customer_type, c.is_buyer ? 'Kunde' : 'Interessent',
      c.birthday ? c.birthday.split('-').reverse().join('.') : '', c.email, c.mobile, c.phone, U.INTERVAL_LABEL[c.visit_interval] || '', c.info, c.owner_name, c.last_contact ? c.last_contact.slice(0, 10).split('-').reverse().join('.') : '', c.created_at]),
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Kunden');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseWorkbook, template, exportCustomers };

// ---------- Dubletten erkennen & zusammenführen ----------
const MERGE_FIELDS = ['salutation', 'first_name', 'last_name', 'company', 'street', 'zip', 'city', 'customer_type', 'birthday', 'email', 'mobile', 'phone', 'visit_interval'];
const CONTACT_FIELDS = { email: 'E-Mail', mobile: 'Handy', phone: 'Festnetz' };
const normName = (s) => String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const normPhone = (s) => { let d = String(s ?? '').replace(/[^\d+]/g, ''); if (d.startsWith('+49')) d = '0' + d.slice(3); else if (d.startsWith('0049')) d = '0' + d.slice(4); return d.replace(/\D/g, ''); };
const empty = (v) => v === null || v === undefined || String(v).trim() === '';

/** Schlüssel, an denen dieselbe Person erkannt wird */
function dupKeys(c) {
  const keys = [];
  const last = normName(c.last_name); const first = normName(c.first_name);
  if (last) keys.push(`n:${first}|${last}|${String(c.zip ?? '').replace(/\D/g, '')}`);
  if (!empty(c.email)) keys.push(`e:${String(c.email).trim().toLowerCase()}`);
  const mob = normPhone(c.mobile); if (mob.length >= 8) keys.push(`m:${mob}`);
  return keys;
}

/** Werte von b in a ergänzen; abweichende Kontaktdaten wandern ins Infofeld. Gibt geänderte Felder zurück. */
function mergeInto(a, b) {
  const changed = [];
  const extra = [];
  for (const f of MERGE_FIELDS) {
    if (empty(b[f])) continue;
    if (empty(a[f])) { a[f] = b[f]; changed.push(f); continue; }
    if (CONTACT_FIELDS[f]) {
      const same = f === 'email' ? String(a[f]).toLowerCase() === String(b[f]).toLowerCase() : normPhone(a[f]) === normPhone(b[f]);
      if (!same) extra.push(`${CONTACT_FIELDS[f]}: ${b[f]}`);
    }
  }
  if (Number(b.is_buyer) === 1 && Number(a.is_buyer) !== 1) { a.is_buyer = 1; changed.push('is_buyer'); }
  const infoAdd = [b.info, extra.length ? `Weitere Kontaktdaten: ${extra.join(', ')}` : ''].filter((x) => !empty(x));
  for (const t of infoAdd) {
    if (!String(a.info || '').includes(t)) { a.info = [a.info, t].filter((x) => !empty(x)).join('\n'); if (!changed.includes('info')) changed.push('info'); }
  }
  return changed;
}

/** Fasst doppelte Zeilen innerhalb der Datei zusammen und markiert Treffer in den vorhandenen Kunden. */
function dedupe(rows, existing) {
  const groups = []; const byKey = new Map();
  for (const r of rows) {
    if (r._error) { groups.push({ ...r, _count: 1 }); continue; }
    const keys = dupKeys(r);
    // Über E-Mail/Handy nur zusammenführen, wenn auch der Nachname passt (Familien teilen oft eine Adresse)
    const compatible = (k, x) => x && (k.startsWith('n:') || !normName(x.last_name) || !normName(r.last_name) || normName(x.last_name) === normName(r.last_name));
    const g = keys.map((k) => [k, byKey.get(k)]).find(([k, x]) => compatible(k, x))?.[1];
    if (g) { mergeInto(g, r); g._count++; }
    else { const n = { ...r, info: r.info || '', _count: 1 }; groups.push(n); keys.forEach((k) => byKey.set(k, n)); continue; }
    dupKeys(g).forEach((k) => byKey.set(k, g));
  }
  const exByKey = new Map();
  for (const c of existing) for (const k of dupKeys(c)) if (!exByKey.has(k)) exByKey.set(k, c);
  for (const g of groups) {
    if (g._error) continue;
    const hit = dupKeys(g).map((k) => [k, exByKey.get(k)])
      .find(([k, x]) => x && (k.startsWith('n:') || normName(x.last_name) === normName(g.last_name)))?.[1];
    g._duplicate = hit ? hit.id : null;
    g._duplicate_name = hit ? [hit.first_name, hit.last_name].filter(Boolean).join(' ') : null;
  }
  return groups;
}

module.exports.dedupe = dedupe;
module.exports.mergeInto = mergeInto;
module.exports.MERGE_FIELDS = MERGE_FIELDS;
