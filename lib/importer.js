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
  tags: ['schlagworte', 'schlagwort', 'tags', 'tag', 'stichworte', 'merkmale'],
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

function readSheetRows(buf) {
  let wb;
  if (isBinarySheet(buf)) {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
  } else {
    const text = decodeText(buf);
    const first = text.split(/\r?\n/, 1)[0] || '';
    const count = (ch) => first.split(ch).length - 1;
    const FS = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
    wb = XLSX.read(text, { type: 'string', FS, raw: true, cellDates: false });
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
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
      email: U.str(o.email, 200), mobile: phone(o.mobile), phone: phone(o.phone), visit_interval: toInterval(o.visit_interval), is_buyer: toBuyer(o.is_buyer), tags: U.tagsStore(U.tagsFrom(o.tags)), info: U.str(o.info, 5000) || '',
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
    ['Kundennr.', 'Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Status', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall', 'Schlagworte', 'Info', 'Betreuer', 'Letzter Kontakt', 'Angelegt am'],
    ...list.map((c) => [c.id, c.salutation, c.first_name, c.last_name, c.company, c.street, c.zip, c.city, c.customer_type, c.is_buyer ? 'Kunde' : 'Interessent',
      c.birthday ? c.birthday.split('-').reverse().join('.') : '', c.email, c.mobile, c.phone, U.INTERVAL_LABEL[c.visit_interval] || '', U.tagsFrom(c.tags).join(', '), c.info, c.owner_name, c.last_contact ? c.last_contact.slice(0, 10).split('-').reverse().join('.') : '', c.created_at]),
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
  const newTags = U.tagsFrom([...U.tagsFrom(a.tags), ...U.tagsFrom(b.tags)]);
  if (newTags.length !== U.tagsFrom(a.tags).length) { a.tags = U.tagsStore(newTags); changed.push('tags'); }
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


// ---------- Maschinen-Import (Maschinen den vorhandenen Kunden zuordnen) ----------
const M_ALIASES = {
  customer_no: ['kundennr', 'kundennummer', 'kunden nr', 'kunden-nr', 'kd nr', 'kd-nr', 'kdnr', 'kunde nr', 'kundenid', 'kunden id', 'debitor', 'debitorennummer', 'customer id'],
  customer_name: ['kunde', 'kundenname', 'name kunde', 'besitzer', 'eigentümer', 'eigentuemer', 'halter', 'customer'],
  first_name: ['vorname'], last_name: ['nachname', 'name', 'familienname'],
  company: ['firma', 'firmenname', 'betrieb', 'unternehmen'],
  street: ['strasse', 'straße', 'straße und hausnummer', 'strasse und hausnummer', 'adresse', 'anschrift'],
  zip: ['plz', 'postleitzahl'], city: ['ort', 'wohnort', 'stadt'],
  email: ['email', 'e-mail', 'mail'], mobile: ['handy', 'handynummer', 'mobil', 'mobilnummer'], phone: ['telefon', 'festnetz', 'tel', 'tel.', 'telefonnummer'],
  category: ['art', 'maschinenart', 'geräteart', 'geraeteart', 'gerät', 'geraet', 'kategorie', 'gerätetyp', 'geraetetyp', 'maschinentyp', 'warengruppe', 'produktgruppe'],
  brand: ['marke', 'hersteller', 'fabrikat', 'brand'],
  model: ['modell', 'typ', 'modellbezeichnung', 'typenbezeichnung', 'bezeichnung', 'maschine', 'artikel', 'artikelbezeichnung', 'produkt'],
  serial: ['seriennummer', 'serien nr', 'serien-nr', 'seriennr', 'serial', 'sn', 's/n', 'fgst nr', 'fgst-nr', 'fahrgestellnummer', 'fin', 'ident nr', 'ident-nr', 'identnummer', 'maschinennummer', 'masch nr', 'masch-nr'],
  year: ['baujahr', 'bj', 'bj.', 'jahrgang'],
  purchase_date: ['kaufdatum', 'verkaufsdatum', 'gekauft am', 'lieferdatum', 'auslieferung', 'auslieferdatum', 'rechnungsdatum'],
  sold_by_us: ['bei uns gekauft', 'von uns verkauft', 'verkauft durch uns', 'eigenverkauf'],
  service_interval: ['wartungsintervall', 'serviceintervall', 'intervall'],
  last_service: ['letzte wartung', 'letzter service', 'letzte inspektion', 'wartung am'],
  next_service: ['nächste wartung', 'naechste wartung', 'nächster service', 'naechster service', 'nächste inspektion', 'wartung fällig', 'fällig'],
  hours: ['betriebsstunden', 'bh', 'stunden', 'motorstunden'],
  notes: ['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'info', 'hinweis'],
};
const M_LOOKUP = {};
for (const [field, list] of Object.entries(M_ALIASES)) for (const a of list) M_LOOKUP[norm(a)] = field;
const yes = (v) => /^(ja|j|x|1|true|yes|wahr)$/i.test(String(v ?? '').trim());

function parseMachines(buf, customers) {
  const rows = readSheetRows(buf);
  const headerIdx = rows.findIndex((r) => r.filter((h) => M_LOOKUP[norm(h)]).length >= 2);
  if (headerIdx < 0) throw new Error('Keine passende Kopfzeile gefunden. Bitte die Vorlage verwenden (Kunde/Nachname, Marke, Modell, Seriennummer …).');
  const header = rows[headerIdx];
  const map = header.map((h) => M_LOOKUP[norm(h)] || null);
  const mapping = header.map((h, i) => ({ column: String(h), field: map[i] })).filter((x) => x.column);
  if (!map.some((f) => ['brand', 'model', 'category', 'serial'].includes(f))) throw new Error('Keine Maschinen-Spalten erkannt (z. B. Marke, Modell, Seriennummer).');

  // Index der vorhandenen Kunden
  const idx = { id: new Map(), email: new Map(), phone: new Map(), name: new Map(), company: new Map() };
  const add = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(c)) m.get(k).push(c); };
  for (const c of customers) {
    idx.id.set(String(c.id), c);
    add(idx.email, String(c.email || '').trim().toLowerCase(), c);
    for (const p of [c.mobile, c.phone]) { const n = normPhone(p); if (n.length >= 6) add(idx.phone, n, c); }
    const l = normName(c.last_name); const f = normName(c.first_name);
    if (l) { add(idx.name, `${f}|${l}`, c); add(idx.name, `|${l}`, c); add(idx.name, `${l}|${f}`, c); }
    if (c.company) add(idx.company, normName(c.company), c);
  }
  const narrow = (list, o) => {
    if (!list || list.length < 2) return list;
    const z = String(o.zip ?? '').replace(/\D/g, ''); const city = normName(o.city);
    let l = list;
    if (z) { const x = l.filter((c) => String(c.zip || '').replace(/\D/g, '') === z.padStart(5, '0')); if (x.length) l = x; }
    if (l.length > 1 && city) { const x = l.filter((c) => normName(c.city) === city); if (x.length) l = x; }
    return l;
  };

  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.some((v) => String(v).trim() !== '')) continue;
    const o = {};
    r.forEach((v, i) => { const f = map[i]; if (f && o[f] == null && String(v).trim() !== '') o[f] = v; });
    // Maschine
    let year = o.year != null ? Number(String(o.year).trim().slice(0, 4)) : null;
    if (o.year instanceof Date) year = o.year.getFullYear();
    const m = {
      category: U.str(o.category, 60), brand: U.str(o.brand, 60), model: U.str(o.model, 100), serial: U.str(o.serial, 100),
      year: Number.isInteger(year) && year > 1900 && year < 2200 ? year : null,
      purchase_date: toDate(o.purchase_date), sold_by_us: o.sold_by_us != null ? (yes(o.sold_by_us) ? 1 : 0) : null,
      service_interval: toInterval(o.service_interval), last_service: toDate(o.last_service), next_service: toDate(o.next_service),
      notes: [o.hours != null ? `Betriebsstunden: ${o.hours}` : '', U.str(o.notes, 3000) || ''].filter(Boolean).join('\n'),
    };
    if (typeof o.model === 'number') m.model = String(o.model);
    if (typeof o.serial === 'number') m.serial = String(o.serial);
    const cust = {
      first_name: U.str(o.first_name, 100), last_name: U.str(o.last_name, 100), company: U.str(o.company, 200), street: U.str(o.street, 200),
      zip: o.zip != null ? U.str(/^\d{4}$/.test(String(o.zip).trim()) ? '0' + String(o.zip).trim() : o.zip, 10) : null, city: U.str(o.city, 100),
      email: U.str(o.email, 200), mobile: phone(o.mobile), phone: phone(o.phone),
    };
    // "Kunde: Max Mustermann" in einer Spalte
    if (o.customer_name && !cust.last_name) {
      const parts = String(o.customer_name).trim().split(/\s+/);
      if (parts.length > 1) { cust.last_name = parts.pop(); cust.first_name = parts.join(' '); } else cust.last_name = parts[0];
      cust._full = String(o.customer_name).trim();
    }
    // Zuordnung
    let hits = null; let via = '';
    if (o.customer_no != null && idx.id.has(String(o.customer_no).trim())) { hits = [idx.id.get(String(o.customer_no).trim())]; via = 'Kundennr.'; }
    if (!hits && cust.email) { hits = idx.email.get(cust.email.toLowerCase()); via = 'E-Mail'; }
    if (!hits) for (const p of [cust.mobile, cust.phone]) { const n = normPhone(p); if (n.length >= 6 && idx.phone.get(n)) { hits = idx.phone.get(n); via = 'Telefon'; break; } }
    if (!hits && cust.last_name) {
      hits = idx.name.get(`${normName(cust.first_name)}|${normName(cust.last_name)}`) || (cust._full ? idx.company.get(normName(cust._full)) : null);
      if (!hits && cust._full) { const p = cust._full.split(/\s+/); hits = idx.name.get(`${normName(p[0])}|${normName(p.slice(1).join(''))}`); } // "Mustermann Max"
      if (!hits && !cust.first_name) hits = idx.name.get(`|${normName(cust.last_name)}`);
      via = 'Name';
    }
    if (!hits && cust.company) { hits = idx.company.get(normName(cust.company)); via = 'Firma'; }
    hits = narrow(hits, cust) || [];
    const row = { ...m, _cust: cust, _via: via, _label: cust._full || [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.company || '' };
    if (hits.length === 1) { row.customer_id = hits[0].id; row._customer_name = [hits[0].first_name, hits[0].last_name].filter(Boolean).join(' ') + (hits[0].city ? ` (${hits[0].city})` : ''); }
    else if (hits.length > 1) row._candidates = hits.slice(0, 8).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' '), city: [c.zip, c.city].filter(Boolean).join(' ') }));
    row._error = !m.brand && !m.model && !m.category && !m.serial ? 'Keine Maschinenangaben' : null;
    out.push(row);
  }
  return { rows: out, mapping };
}

function machineTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Kundennr.', 'Vorname', 'Nachname', 'PLZ', 'Ort', 'Art', 'Marke', 'Modell', 'Seriennummer', 'Baujahr', 'Kaufdatum', 'Bei uns gekauft', 'Wartungsintervall', 'Letzte Wartung', 'Nächste Wartung', 'Betriebsstunden', 'Bemerkung'],
    ['', 'Max', 'Mustermann', '48727', 'Billerbeck', 'Rasentraktor', 'Husqvarna', 'TS 142', 'HQ-4711', 2021, '15.04.2021', 'ja', 'Jährlich', '20.03.2025', '', 120, 'Mähwerk 107 cm'],
  ]);
  ws['!cols'] = [10, 12, 14, 8, 14, 14, 12, 14, 16, 8, 11, 10, 14, 13, 13, 10, 24].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Maschinen');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports.parseMachines = parseMachines;
module.exports.machineTemplate = machineTemplate;
module.exports.normSerial = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
