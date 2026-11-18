'use strict';
/**
 * Angebote (Maschinen): speichern und als PDF im Layout des Firmen-Briefpapiers ausgeben.
 * Das Layout ist dem Angebot aus der Warenwirtschaft nachgebaut (A4, Arial/Helvetica):
 * Anschrift links, Block „ANGEBOT“ rechts, graue Kopfzeile der Positionen, Summenblock unten rechts.
 * Briefpapier: Einstellungen → Firma → Briefpapier (Bild in A4). Ohne Briefpapier zeichnet das CRM
 * Logo, Firmenangaben und Fußzeile selbst.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { get, all, run, getSetting, setSetting, DATA_DIR } = require('./db');
const U = require('./util');
const Co = require('./company');

const STATUS = { offen: 'Offen', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt' };
const SALUTATIONS = ['Herrn', 'Frau', 'Firma', 'Familie', 'Eheleute', ''];
const DEFAULT_TERMS = (c) => `Die Ware bleibt bis zur vollständigen Bezahlung Eigentum der Firma ${c.name}${c.zip_city ? ', ' + c.zip_city.replace(/^\d+\s*/, '') : ''}. Es gelten unsere AGB.\nSofern nicht anders ausgewiesen entspricht das Liefer-/Leistungsdatum dem Rechnungsdatum.`;
const LETTER_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
// Bussmann-Installation: eigene USt-IdNr einmalig vorbelegen (steht auf jedem Angebot im Kopf)
if (getSetting('company_logo') === 'builtin' && !getSetting('offer_vat_id_set')) { if (!getSetting('offer_vat_id')) setSetting('offer_vat_id', 'DE414176573'); setSetting('offer_vat_id_set', '1'); }

// ---------- Hilfen ----------
const pt = (px) => px * 0.48;               // Maße aus dem Original (150 dpi) in PDF-Punkte
const num = (n, d = 2) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const de = (d) => (d ? d.split('-').reverse().join('.') : '');
const deShort = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '');
const r2 = (n) => Math.round(n * 100) / 100;
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : null;
  let s = String(v).replace(/[€\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : null;
}
const parseJson = (v, d) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || ''); return Array.isArray(a) ? a : d; } catch { return d; } };

function totals(o) {
  const pos = parseJson(o.positions, []);
  const net = r2(pos.reduce((n, p) => n + r2((Number(p.qty) || 0) * (Number(p.price) || 0)), 0));
  const rate = o.vat_rate == null ? 19 : Number(o.vat_rate);
  const vat = r2(net * rate / 100);
  return { net, vat, gross: r2(net + vat), rate };
}

// ---------- Briefpapier ----------
function letterFile() {
  const l = getSetting('offer_letterhead');
  if (!l) return null;
  const f = path.join(DATA_DIR, l);
  return fs.existsSync(f) ? f : null;
}
function setLetterhead(buf, mime) {
  const ext = LETTER_TYPES[mime];
  if (!ext) throw new Error('Bitte das Briefpapier als JPG oder PNG hochladen (A4, hochkant)');
  const old = getSetting('offer_letterhead');
  const name = `letterhead.${ext}`;
  fs.writeFileSync(path.join(DATA_DIR, name), buf);
  if (old && old !== name) { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch { /* egal */ } }
  setSetting('offer_letterhead', name);
}
function clearLetterhead() {
  const old = getSetting('offer_letterhead');
  if (old) { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch { /* egal */ } }
  setSetting('offer_letterhead', '');
}

function offerSettings() {
  const c = Co.company();
  return {
    terms: getSetting('offer_terms') || DEFAULT_TERMS(c),
    terms_custom: !!getSetting('offer_terms'),
    valid_days: Number(getSetting('offer_valid_days')) || 30,
    next_number: nextNumber(),
    vat_id: getSetting('offer_vat_id') || '',
    bank: getSetting('offer_bank') || '',
    letterhead: !!letterFile(),
  };
}
function saveOfferSettings(b) {
  if (b.terms !== undefined) setSetting('offer_terms', String(b.terms || '').trim().slice(0, 2000));
  if (b.valid_days !== undefined) { const n = parseInt(b.valid_days, 10); if (n >= 1 && n <= 365) setSetting('offer_valid_days', String(n)); }
  if (b.next_number !== undefined) { const n = parseInt(String(b.next_number).replace(/\D/g, ''), 10); if (n > 0) setSetting('offer_next', String(n)); }
  if (b.vat_id !== undefined) setSetting('offer_vat_id', String(b.vat_id || '').trim().slice(0, 30));
  if (b.bank !== undefined) setSetting('offer_bank', String(b.bank || '').trim().slice(0, 300));
}
function nextNumber() {
  const start = Number(getSetting('offer_next')) || 1;
  const max = get("SELECT MAX(CAST(number AS INTEGER)) n FROM offers WHERE number GLOB '[0-9]*'").n || 0;
  return Math.max(start, max + 1);
}

// ---------- PDF ----------
const FONT = 'Helvetica'; const BOLD = 'Helvetica-Bold';
const X = { left: pt(148), right: pt(1180), menge: pt(767), epreis: pt(944), endpreis: pt(1145), m: pt(1160), artnr: pt(183), bez: pt(372), info: pt(738), infoVal: pt(915) };
const FS = 9.0;           // Schriftgröße Fließtext
const LH = pt(20.8);      // Zeilenabstand

function drawFallbackLetterhead(doc, c, bank) {
  // Logo / Firmenname oben links, Anschrift oben rechts, Absenderzeile über dem Fenster, Fußzeile
  const logo = Co.logoFile();
  if (logo && /png|jpeg/.test(logo.type)) { try { doc.image(logo.file, pt(124), pt(70), { fit: [pt(470), pt(160)] }); } catch { /* Bild nicht lesbar */ } } else doc.font(BOLD).fontSize(20).fillColor(c.color).text(c.name, pt(124), pt(110), { width: pt(470) });
  doc.fillColor('#444').font(FONT).fontSize(9.5);
  const right = [c.name, [c.street, c.zip_city].filter(Boolean).join(' · '), '', c.phone ? 'Telefon: ' + c.phone : '', c.email].filter((x, i) => x || i === 2);
  let y = pt(152);
  for (const l of right) { if (l) doc.text(l, pt(600), y, { width: pt(564), align: 'right' }); y += 12.5; }
  if (c.website) doc.font(BOLD).fillColor(c.color).text(c.website.replace(/^https?:\/\//, ''), pt(600), y, { width: pt(564), align: 'right' });
  doc.font(FONT).fontSize(6.5).fillColor('#555').text([c.name, c.street, c.zip_city].filter(Boolean).join(' · '), pt(124), pt(268), { width: pt(460), underline: true });
  doc.fontSize(8.5).fillColor('#444');
  const fy = pt(1625);
  doc.text([[c.street, c.zip_city].filter(Boolean).join(' · '), c.phone ? 'Telefon: ' + c.phone : '', c.email].filter(Boolean).join('\n'), pt(124), fy, { width: pt(380), lineGap: 1.5 });
  if (bank) doc.text(bank.split(/\s*[·|]\s*|\n/).join('\n'), pt(540), fy, { width: pt(450), lineGap: 1.5 });
  doc.fillColor('#000');
}

function pageBackground(doc, ctx) {
  if (ctx.letter) doc.image(ctx.letter, 0, 0, { width: doc.page.width, height: doc.page.height });
  else drawFallbackLetterhead(doc, ctx.c, ctx.bank);
  doc.fillColor('#000');
}

function tableHead(doc, y) {
  doc.save().moveTo(X.left, y - 1).lineTo(X.right, y - 1).lineWidth(0.6).strokeColor('#444').stroke().restore();
  doc.rect(X.left, y, X.right - X.left, pt(26)).fill('#d6d6d6');
  doc.fillColor('#000').font(FONT).fontSize(FS);
  const ty = y + 3;
  doc.text('Pos Artikel', X.left, ty, { lineBreak: false });
  doc.text('Menge', X.menge - 60, ty, { width: 60, align: 'right' });
  doc.text('E-Preis', X.epreis - 70, ty, { width: 70, align: 'right' });
  doc.text('Endpreis', X.endpreis - 70, ty, { width: 70, align: 'right' });
  doc.text('M', X.m, ty, { lineBreak: false });
  return y + pt(26);
}

function buildPdf(o) {
  const c = Co.company();
  const st = offerSettings();
  const ctx = { c, bank: st.bank, letter: letterFile() };
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: false,
    info: { Title: `Angebot ${o.number}`, Author: c.name, Subject: `Angebot ${o.number} ${o.name || ''}`.trim(), Creator: c.app_name } });
  const PAGE_BOTTOM = pt(1600);       // darüber beginnt die Fußzeile des Briefpapiers
  const TOTALS_TOP = pt(1330);        // Summenblock auf der letzten Seite
  const newPage = (first, table = true) => {
    doc.addPage({ size: 'A4', margin: 0 });
    pageBackground(doc, ctx);
    if (first) return headerFirst();
    // Folgeseite: kleiner Kopf unter dem Briefkopf
    doc.font(BOLD).fontSize(10).text(`ANGEBOT ${o.number}`, X.left, pt(330), { lineBreak: false });
    doc.font(FONT).fontSize(FS).text(o.name || '', X.left + 120, pt(332), { lineBreak: false });
    return table ? tableHead(doc, pt(380)) + pt(22) : pt(400);
  };
  const headerFirst = () => {
    // Anschrift
    doc.font(FONT).fontSize(FS).fillColor('#000');
    const addr = [o.salutation, o.name, o.name2, o.street, '', o.zip_city].filter((x, i, a) => x || (i === 4 && false));
    let y = pt(328);
    for (const l of addr) { if (l) { doc.text(l, X.left, y, { width: pt(560), lineBreak: false }); y += pt(21); } }
    // Block rechts
    doc.font(BOLD).fontSize(14.5).text('ANGEBOT', X.info, pt(343), { lineBreak: false, horizontalScaling: 84 });
    const rows = [['Nummer:', String(o.number), true], ['Kunden-Nr.:', o.customer_no || ''], ['Datum:', de(o.date)], ['USt-IdNr:', o.vat_id || ''], ['Seite:', '__PAGE__']].filter((r) => r[1]);
    y = pt(380);
    for (const [k, v, b] of rows) {
      doc.font(b ? BOLD : FONT).fontSize(FS).text(k, X.info, y, { lineBreak: false });
      if (v === '__PAGE__') ctx.pageY = y; else doc.text(v, X.infoVal, y, { lineBreak: false });
      y += pt(21);
    }
    return tableHead(doc, pt(591)) + pt(30);
  };

  let y = newPage(true);
  doc.font(FONT).fontSize(FS);
  const positions = parseJson(o.positions, []);
  positions.forEach((p, i) => {
    const lines = String(p.text || '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const inline = lines.length <= 1;
    const need = (inline ? 0 : lines.length * LH) + LH + pt(8);
    if (y + need > PAGE_BOTTOM) y = newPage(false);
    doc.font(FONT).fontSize(FS).fillColor('#000');
    if (!inline) { for (const l of lines) { doc.text(l, X.left, y, { width: X.menge - X.left - 80, lineBreak: false }); y += LH; } y += pt(4); }
    doc.text(String(i + 1), X.left, y, { lineBreak: false });
    if (p.artnr) doc.text(String(p.artnr), X.artnr, y, { lineBreak: false });
    if (inline && lines[0]) doc.text(lines[0], p.artnr ? X.bez : X.artnr, y, { width: X.menge - 70 - (p.artnr ? X.bez : X.artnr), lineBreak: false, ellipsis: true });
    const qty = Number(p.qty) || 0; const price = Number(p.price) || 0;
    doc.text(num(qty), X.menge - 70, y, { width: 70, align: 'right' });
    doc.text(num(price), X.epreis - 90, y, { width: 90, align: 'right' });
    doc.text(num(r2(qty * price)), X.endpreis - 90, y, { width: 90, align: 'right' });
    doc.text('1', X.m + 5, y, { lineBreak: false });
    y += LH + pt(6);
  });

  // Freitext nach den Positionen (z. B. Mehrpreise, Optionen)
  if (o.text) {
    y += pt(74);
    doc.font(FONT).fontSize(FS);
    for (const l of String(o.text).replace(/\r/g, '').split('\n')) {
      if (y + LH > PAGE_BOTTOM) y = newPage(false);
      // Tabulator trennt Spalten wie im Original („Mehrpreis für …⇥182,41 € + 19% MWSt“)
      const [a, ...rest] = l.split(/\t| {3,}/);
      doc.text(a, X.left, y, { width: X.right - X.left, lineBreak: false });
      if (rest.length) doc.text(rest.join('   '), X.left + pt(335), y, { lineBreak: false });
      y += LH;
    }
  }

  // Summenblock unten auf der letzten Seite
  if (y > TOTALS_TOP - pt(10)) newPage(false, false);
  const t = totals(o);
  const tx = pt(502); const tr = pt(1150);
  let ty = TOTALS_TOP + pt(14);
  doc.save().moveTo(tx, ty).lineTo(tr, ty).lineWidth(1.2).strokeColor('#000').stroke().restore();
  ty += pt(9);
  doc.font(FONT).fontSize(FS).fillColor('#000');
  const col = (s, right, yy, f = FONT) => doc.font(f).text(s, right - 110, yy, { width: 110, align: 'right' });
  col('Netto-Betrag', pt(850), ty); col('MwSt-Betrag', pt(997), ty); col('Brutto-Betrag', pt(1145), ty);
  ty += pt(27);
  col(`${t.rate.toFixed(2)}% MwSt. (1)`, pt(703), ty); col(num(t.net), pt(850), ty); col(num(t.vat), pt(997), ty); col(num(t.gross), pt(1145), ty);
  ty += pt(21);
  col('Summe', pt(703), ty); col(num(t.net), pt(850), ty); col(num(t.vat), pt(997), ty); col(num(t.gross), pt(1145), ty);
  ty += pt(21);
  doc.save().moveTo(tx, ty - 1).lineTo(tr, ty - 1).lineWidth(0.5).strokeColor('#000').stroke().restore();
  ty += pt(6);
  doc.font(BOLD).text('Gesamtbetrag in EUR', pt(508), ty, { lineBreak: false });
  col(num(t.gross), pt(1145), ty, BOLD);
  ty += pt(20);
  doc.save().lineWidth(0.8).strokeColor('#000');
  doc.moveTo(tx, ty).lineTo(tr, ty).stroke(); doc.moveTo(tx, ty + 2.4).lineTo(tr, ty + 2.4).stroke(); doc.restore();
  ty += pt(38);
  if (o.valid_until) doc.font(FONT).fontSize(8.25).text(`Das Angebot ist gültig bis zum ${deShort(o.valid_until)}.`, pt(600), ty, { width: pt(545), align: 'right' });
  ty += pt(66);
  doc.font(FONT).fontSize(6.05).fillColor('#000').text(st.terms, X.left, ty, { width: X.right - X.left, lineGap: 0.2 });

  // Seitenzahlen nachtragen
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    if (i === 0 && ctx.pageY != null) doc.font(FONT).fontSize(FS).fillColor('#000').text(`${i + 1}/${range.count}`, X.infoVal, ctx.pageY, { lineBreak: false });
    else if (i > 0) doc.font(FONT).fontSize(FS).text(`Seite ${i + 1}/${range.count}`, pt(900), pt(332), { width: pt(280), align: 'right' });
  }
  doc.end();
  return doc;
}

// ---------- Daten ----------
const OFFER_SQL = `SELECT o.*, u.name user_name, m.brand m_brand, m.model m_model, m.category m_category, m.status m_status
  FROM offers o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN used_machines m ON m.id=o.used_id`;
const out = (o) => (o ? { ...o, positions: parseJson(o.positions, []), ...totals(o), machine: o.used_id ? [o.m_brand, o.m_model].filter(Boolean).join(' ') || o.m_category || 'Maschine' : '' } : null);

function clean(b, user, old) {
  const positions = parseJson(b.positions, []).slice(0, 60).map((p) => ({
    artnr: U.str(p && p.artnr, 30) || '', text: String((p && p.text) || '').replace(/\r/g, '').slice(0, 3000),
    qty: money(p && p.qty) ?? 1, price: money(p && p.price),
  })).filter((p) => p.text.trim() || p.artnr || p.price != null).map((p) => ({ ...p, price: p.price ?? 0 }));
  const o = {
    number: U.str(b.number, 30) || (old ? old.number : String(nextNumber())),
    customer_id: b.customer_id && get('SELECT id FROM customers WHERE id=?', b.customer_id) ? Number(b.customer_id) : null,
    used_id: b.used_id && get('SELECT id FROM used_machines WHERE id=?', b.used_id) ? Number(b.used_id) : null,
    project_id: b.project_id && get('SELECT id FROM projects WHERE id=?', b.project_id) ? Number(b.project_id) : null,
    user_id: b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : (old ? old.user_id : user.id),
    salutation: SALUTATIONS.includes(b.salutation) ? b.salutation : U.str(b.salutation, 30) || '',
    name: U.str(b.name, 120) || '', name2: U.str(b.name2, 120) || '', street: U.str(b.street, 120) || '', zip_city: U.str(b.zip_city, 120) || '',
    customer_no: U.str(b.customer_no, 30) || '', vat_id: U.str(b.vat_id, 30) || '',
    date: U.isDate(b.date) ? b.date : U.today(),
    valid_until: U.isDate(b.valid_until) ? b.valid_until : null,
    positions: JSON.stringify(positions), text: String(b.text || '').replace(/\r/g, '').slice(0, 3000),
    vat_rate: [0, 7, 19].includes(Number(b.vat_rate)) ? Number(b.vat_rate) : 19,
    status: STATUS[b.status] ? b.status : 'offen',
  };
  if (!o.name) return { error: 'Bitte den Empfänger (Name) angeben' };
  if (!positions.length) return { error: 'Bitte mindestens eine Position eintragen' };
  const dup = get('SELECT id FROM offers WHERE number=? AND id<>?', o.number, old ? old.id : 0);
  if (dup) return { error: `Die Angebotsnummer ${o.number} ist schon vergeben` };
  return { o };
}
const FIELDS = ['number', 'customer_id', 'used_id', 'project_id', 'user_id', 'salutation', 'name', 'name2', 'street', 'zip_city', 'customer_no', 'vat_id', 'date', 'valid_until', 'positions', 'text', 'vat_rate', 'status'];

/** Vorschlag für eine neue Angebots-Position aus einer Lagermaschine */
function machineDraft(m) {
  const cond = { neu: 'Neumaschine', vorfuehr: 'Vorführmaschine' }[m.condition] || 'Gebrauchtmaschine';
  const eq = String(m.equipment || '').split(/\n|,(?=\s)(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  const lines = [[m.category, cond].filter(Boolean).join(' - '), [m.brand, m.model].filter(Boolean).join(' '),
    m.year ? `Baujahr ${m.year}` : '', m.hours != null && !(m.condition === 'neu' && !m.hours) ? `${Number(m.hours).toLocaleString('de-DE')} Betriebsstunden` : '',
    m.serial ? `Seriennummer ${m.serial}` : '', ...eq].filter(Boolean);
  return { artnr: '', text: lines.join('\n'), qty: 1, price: m.asking_price ?? 0 };
}

module.exports = function offers(app, { auth, admin, express }) {
  const bad = (res, msg) => res.status(400).json({ error: msg });
  // Angebot angenommen -> Lagermaschine reservieren
  const reserve = (o) => { if (o.status === 'angenommen' && o.used_id) run("UPDATE used_machines SET status='reserviert', updated_at=datetime('now','localtime') WHERE id=? AND status='verfuegbar'", o.used_id); };

  app.get('/api/offers', auth, (req, res) => {
    const where = []; const p = [];
    if (STATUS[req.query.status]) { where.push('o.status=?'); p.push(req.query.status); }
    if (req.query.customer_id) { where.push('o.customer_id=?'); p.push(Number(req.query.customer_id)); }
    if (req.query.used_id) { where.push('o.used_id=?'); p.push(Number(req.query.used_id)); }
    if (req.query.q) { where.push("(o.number || ' ' || o.name || ' ' || o.zip_city || ' ' || o.positions) LIKE ?"); p.push(`%${req.query.q}%`); }
    const rows = all(`${OFFER_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.date DESC, o.id DESC LIMIT 500`, ...p).map(out);
    res.json({ rows, statuses: STATUS });
  });

  /** Entwurf für ein neues Angebot (nächste Nummer, Datum, Gültigkeit, ggf. Kunde und Maschine) */
  app.get('/api/offers/draft', auth, (req, res) => {
    const st = offerSettings();
    const d = { number: String(st.next_number), date: U.today(), valid_until: U.addDays(U.today(), st.valid_days), salutation: '', name: '', name2: '', street: '', zip_city: '', customer_no: '', vat_id: st.vat_id, positions: [], text: '', vat_rate: 19, status: 'offen', user_id: req.user.id };
    const m = req.query.used_id ? get('SELECT * FROM used_machines WHERE id=?', req.query.used_id) : null;
    if (m) { d.used_id = m.id; d.positions.push(machineDraft(m)); if (m.customer_id && !req.query.customer_id) { /* Vorbesitzer ist nicht der Käufer */ } }
    const custId = req.query.customer_id;
    if (custId) Object.assign(d, customerAddress(custId));
    if (req.query.project_id) {
      const pr = get('SELECT * FROM projects WHERE id=?', req.query.project_id);
      if (pr) { d.project_id = pr.id; if (pr.customer_id && !custId) Object.assign(d, customerAddress(pr.customer_id)); else if (!d.name) { d.name = pr.kunde || ''; d.zip_city = pr.ort || ''; } if (!d.positions.length && (pr.modell || pr.typ)) d.positions.push({ artnr: '', text: [pr.typ, [pr.brand, pr.modell].filter(Boolean).join(' '), ...String(pr.ausstattung || '').split('\n')].filter(Boolean).join('\n'), qty: 1, price: pr.preis ?? 0 }); }
    }
    res.json(d);
  });
  function customerAddress(id) {
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) return {};
    const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
    const sal = c.company || c.salutation === 'Firma' ? 'Firma' : c.salutation === 'Frau' ? 'Frau' : c.salutation === 'Herr' ? 'Herrn' : c.salutation === 'Familie' ? 'Familie' : '';
    const last = get("SELECT customer_no, vat_id FROM offers WHERE customer_id=? AND (customer_no<>'' OR vat_id<>'') ORDER BY id DESC LIMIT 1", c.id) || {};
    return { customer_id: c.id, salutation: sal, name: c.company || person, name2: c.company && person && person !== c.company ? person : '', street: c.street || '', zip_city: [c.zip, c.city].filter(Boolean).join(' '), customer_no: last.customer_no || '', ...(last.vat_id ? { vat_id: last.vat_id } : {}) };
  }
  app.get('/api/offers/customer/:id', auth, (req, res) => res.json(customerAddress(req.params.id)));

  app.get('/api/offers/:id', auth, (req, res) => {
    const o = out(get(`${OFFER_SQL} WHERE o.id=?`, req.params.id));
    if (!o) return res.status(404).json({ error: 'Angebot nicht gefunden' });
    res.json(o);
  });
  app.post('/api/offers', auth, (req, res) => {
    const { o, error } = clean(req.body || {}, req.user);
    if (error) return bad(res, error);
    const id = Number(run(`INSERT INTO offers(${FIELDS.join(',')}, created_by) VALUES(${FIELDS.map(() => '?').join(',')}, ?)`, ...FIELDS.map((f) => o[f]), req.user.id).lastInsertRowid);
    if (/^\d+$/.test(o.number) && Number(o.number) >= (Number(getSetting('offer_next')) || 1)) setSetting('offer_next', String(Number(o.number) + 1));
    reserve(o);
    res.json(out(get(`${OFFER_SQL} WHERE o.id=?`, id)));
  });
  app.put('/api/offers/:id', auth, (req, res) => {
    const old = get('SELECT * FROM offers WHERE id=?', req.params.id);
    if (!old) return res.status(404).json({ error: 'Angebot nicht gefunden' });
    const { o, error } = clean({ ...old, ...req.body }, req.user, old);
    if (error) return bad(res, error);
    run(`UPDATE offers SET ${FIELDS.map((f) => f + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`, ...FIELDS.map((f) => o[f]), old.id);
    reserve(o);
    res.json(out(get(`${OFFER_SQL} WHERE o.id=?`, old.id)));
  });
  app.delete('/api/offers/:id', auth, (req, res) => { run('DELETE FROM offers WHERE id=?', req.params.id); res.json({ ok: true }); });

  app.get('/api/offers/:id/pdf', auth, (req, res) => {
    const o = get('SELECT * FROM offers WHERE id=?', req.params.id);
    if (!o) return res.status(404).send('Nicht gefunden');
    const fname = `Angebot_${o.number}_${(o.name || '').replace(/[^\wäöüÄÖÜß -]/g, '').replace(/\s+/g, '_')}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fname.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    buildPdf(o).pipe(res);
  });

  // Einstellungen für Angebote (Briefpapier, Texte, Nummernkreis)
  app.get('/api/offer-settings', auth, (req, res) => res.json(offerSettings()));
  app.put('/api/offer-settings', auth, admin, (req, res) => { saveOfferSettings(req.body || {}); res.json(offerSettings()); });
  app.post('/api/offer-settings/letterhead', auth, admin, express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    try { setLetterhead(req.body, String(req.get('Content-Type') || '').split(';')[0]); } catch (e) { return bad(res, e.message); }
    res.json(offerSettings());
  });
  app.delete('/api/offer-settings/letterhead', auth, admin, (req, res) => { clearLetterhead(); res.json(offerSettings()); });
  app.get('/api/offer-settings/letterhead', auth, (req, res) => { const f = letterFile(); if (!f) return res.status(404).end(); res.sendFile(f); });
};
module.exports.buildPdf = buildPdf;
module.exports.totals = totals;
