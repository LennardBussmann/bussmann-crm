'use strict';
/**
 * Angebote aus der Warenwirtschaft (PDF mit Text) ohne KI auslesen.
 * Liest den Text mit pdftotext (poppler-utils) im Layout-Modus und erkennt
 * Anschrift, Angebotsnummer, Datum, Positionen, Netto-Summe und Gültigkeit.
 * Liefert dieselben Felder wie die KI-Auswertung (lib/offer.js).
 */
const { execFile } = require('child_process');

function pdfText(buffer) {
  return new Promise((resolve) => {
    const p = execFile('pdftotext', ['-layout', '-enc', 'UTF-8', '-l', '5', '-', '-'], { maxBuffer: 8 * 1024 * 1024, timeout: 20000 }, (err, out) => resolve(err ? '' : String(out)));
    p.on('error', () => resolve(''));
    p.stdin.on('error', () => {});
    p.stdin.end(buffer);
  });
}

const AMOUNT = /^-?\d{1,3}(?:\.\d{3})*,\d{2}-?$/;
const num = (s) => { if (!s) return null; const neg = /-/.test(s); const n = Number(s.replace(/-/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? (neg ? -n : n) : null; };
const isoDate = (s) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/.exec(s || '');
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const SALUT = /^(Firma|Herrn?|Frau|Familie|Eheleute|Herrn und Frau|Herr und Frau|An)$/i;
const BRANDS = [['Massey Ferguson', /\b(massey[\s-]*ferguson|MF)\b/i], ['Weidemann', /\bweidemann\b/i], ['Fendt', /\bfendt\b/i], ['Kubota', /\bkubota\b/i], ['TAFE', /\btafe\b/i], ['Kandi', /\bkandi\b/i], ['Husqvarna', /\bhusqvarna\b/i], ['Stihl', /\bstihl\b/i], ['Kramer', /\bkramer\b/i], ['Valtra', /\bvaltra\b/i]];
const SIDE_COSTS = /(überführung|uberfuhrung|fracht|transport|anlieferung|zulassung|versand)/i;
const TRADE_IN = /(inzahlung|in zahlung|gebrauchtmaschine.*rücknahme|rücknahme)/i;

function guessType(brand, model, text) {
  const t = `${model} ${text}`.toLowerCase();
  const kw = [[/e-?hoftrac/, 'eHoftrac (elektrisch)'], [/hoftrac/, 'Hoftrac'], [/teleskopradlader/, 'Teleskopradlader'], [/teleskop/, 'Teleskoplader'], [/radlader/, 'Radlader'], [/mähdrescher/, 'Mähdrescher'], [/mähroboter|automower|imow/, 'Mähroboter'], [/aufsitzmäher|rider|zero.?turn/, 'Aufsitzmäher'], [/rasentraktor/, 'Rasentraktor'], [/minibagger|bagger/, 'Minibagger'], [/motorsäge/, 'Motorsäge'], [/presse/, 'Presse'], [/kompakttraktor/, 'Kompakttraktor'], [/traktor|schlepper/, 'Traktor']];
  for (const [re, v] of kw) if (re.test(t)) return v;
  if (brand === 'Weidemann') return /\dT\b|T\d/.test(model) ? (/^T/i.test(model) ? 'Teleskoplader' : 'Teleskopradlader') : /^1\d{3}/.test(model) ? 'Hoftrac' : 'Radlader';
  const ps = /(\d{2,3})\s*PS\b/i.exec(text);
  if (['TAFE', 'Kubota', 'Massey Ferguson', 'Fendt', 'Valtra'].includes(brand)) return ps && Number(ps[1]) <= 60 ? 'Kompakttraktor' : 'Traktor';
  return null;
}

/** @returns {object|null} Felder wie in lib/offer.js oder null, wenn das Dokument nicht erkannt wurde */
function parseText(raw) {
  const text = String(raw || '').replace(/­/g, '-').replace(/\r/g, '');
  if (!/angebot/i.test(text)) return null;
  const lines = text.split('\n');
  const head = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); } return null; };
  const x = { firma: null, vorname: null, nachname: null, strasse: null, plz: null, ort: null, ansprechpartner: null, telefon: null, email: null, marke: null, maschinentyp: null, modell: null, ausstattung: null, preis_netto: null, angebot_datum: null, angebot_nr: null, gueltig_bis: null, liefertermin: null, inzahlung: null, inzahlung_wert: null, finanzierung: null, hinweise: null };
  x.angebot_nr = head(/\bNummer:\s+(\S+)/);
  x.angebot_datum = isoDate(head(/\bDatum:\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/));
  const kdnr = head(/Kunden-?\s*Nr\.?:\s+(\S+)/i);

  // Anschrift: linke Spalte oberhalb der Positionen
  const posStart = lines.findIndex((l) => /^\s*Pos\.?\s+Artikel/i.test(l));
  const left = [];
  for (const l of lines.slice(0, posStart > 0 ? posStart : 40)) {
    if (/^\S/.test(l)) { const c = l.split(/\s{2,}/)[0].trim(); if (c && !/@@/.test(c)) left.push(c); }
  }
  const zi = left.findIndex((c) => /^(D-)?\d{5}\s+\S/.test(c));
  if (zi > 0) {
    const m = /^(?:D-)?(\d{5})\s+(.+)$/.exec(left[zi]); x.plz = m[1]; x.ort = m[2].trim();
    let si = left.slice(0, zi).map((c) => SALUT.test(c)).lastIndexOf(true);
    const block = left.slice(si + 1, zi);
    const sal = si >= 0 ? left[si] : '';
    if (block.length) x.strasse = block.length > 1 ? block.pop() : null;
    if (/^firma$/i.test(sal) || block.length > 1) {
      x.firma = block[0] || null;
      const p = block.slice(1).join(' ').replace(/^(z\.\s*Hd\.?|Herrn?|Frau)\s+/i, '').trim();
      if (p) x.ansprechpartner = p;
    } else if (block.length) {
      const parts = block[0].split(/\s+/);
      if (parts.length > 1) { x.nachname = parts.pop(); x.vorname = parts.join(' '); } else x.nachname = parts[0];
    }
  }

  // Positionen
  const end = lines.findIndex((l, i) => i > posStart && /(Netto-?\s*Betrag|Gesamtbetrag|Summe)/i.test(l));
  const items = [];
  if (posStart >= 0) {
    for (const l of lines.slice(posStart + 1, end > 0 ? end : undefined)) {
      if (!l.trim()) continue;
      const chunks = l.trim().split(/\s{2,}/);
      const first = /^(\d{1,3})(?:\s+(\S+))?$/.exec(chunks[0]);
      const amounts = chunks.map((c) => c.replace(/\s+\d$/, '')).filter((c) => AMOUNT.test(c));
      const words = chunks.filter((c, i) => !(i === 0 && first) && !AMOUNT.test(c.replace(/\s+\d$/, '')) && !/^\d$/.test(c));
      if (first && /^\s{0,3}\d/.test(l)) {
        let art = first[2] || null; let desc = words;
        if (!art && desc.length > 1 && /^[A-Z0-9][A-Z0-9.\-/]*\d[A-Z0-9.\-/]*$/.test(desc[0])) { art = desc[0]; desc = desc.slice(1); }
        items.push({ art, desc: desc.join(' '), more: [], qty: amounts.length > 2 ? num(amounts[0]) : 1, total: amounts.length ? num(amounts[amounts.length - 1]) : null });
      } else if (items.length) {
        const it = items[items.length - 1];
        if (words.length) { if (!it.more.length && /\s(mit|und|für|inkl\.?)$/i.test(it.desc)) it.desc += ' ' + words.join(' '); else it.more.push(words.join(' ')); }
        if (it.total == null && amounts.length) it.total = num(amounts[amounts.length - 1]);
      }
    }
  }
  // Netto-Summe: erste Zahl in der Zeile „Summe“, sonst unter „Netto-Betrag“
  for (const l of lines.slice(end > 0 ? end : 0)) {
    const m = /^\s*Summe\s+(-?[\d.]+,\d{2})/.exec(l.trim().replace(/^.*?(Summe)/, '$1'));
    if (m) { x.preis_netto = num(m[1]); break; }
  }
  if (x.preis_netto == null) {
    const ni = lines.findIndex((l) => /Netto-?\s*Betrag/i.test(l));
    if (ni >= 0) { const a = (lines[ni + 1] || '').match(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g); if (a) x.preis_netto = num(a[0]); }
  }
  if (x.preis_netto == null && items.length) x.preis_netto = items.reduce((s, i) => s + (i.total || 0), 0);
  x.gueltig_bis = isoDate(head(/gültig\s+bis\s+(?:zum\s+)?(\d{1,2}\.\d{1,2}\.\d{2,4})/i));
  const lief = head(/(?:Liefertermin|Lieferung)[:\s]+(\d{1,2}\.\d{1,2}\.\d{2,4})/i); if (lief) x.liefertermin = isoDate(lief);

  // Hauptmaschine = erste Position mit Marke, sonst die teuerste
  const trade = items.filter((i) => TRADE_IN.test(i.desc) || (i.total != null && i.total < 0));
  const normal = items.filter((i) => !trade.includes(i));
  let main = normal.find((i) => BRANDS.some(([, re]) => re.test(i.desc))) || [...normal].sort((a, b) => (b.total || 0) - (a.total || 0))[0];
  if (main) {
    const br = BRANDS.find(([, re]) => re.test(main.desc));
    x.marke = br ? br[0] : null;
    x.modell = (br ? main.desc.replace(br[1], '') : main.desc).replace(/^\s*[-–:]\s*/, '').replace(/\s+/g, ' ').trim() || null;
    x.maschinentyp = guessType(x.marke, x.modell || '', [main.desc, ...main.more].join(' '));
    const eq = [main.more.join(', ').replace(/^mit\s+/i, ''), ...normal.filter((i) => i !== main && !SIDE_COSTS.test(i.desc)).map((i) => i.desc)].filter(Boolean);
    x.ausstattung = eq.join(', ').slice(0, 500) || null;
  }
  if (trade.length) {
    x.inzahlung = trade.map((i) => [i.desc, ...i.more].join(' ').replace(/^(inzahlungnahme|in zahlung genommen)[:\s-]*/i, '').trim()).join(', ') || 'Inzahlungnahme';
    x.inzahlung_wert = Math.abs(trade.reduce((s, i) => s + (i.total || 0), 0)) || null;
    if (x.preis_netto != null && x.inzahlung_wert) x.preis_netto = Math.round((x.preis_netto + x.inzahlung_wert) * 100) / 100; // Preis ohne Abzug der Inzahlungnahme
  }
  const side = normal.filter((i) => SIDE_COSTS.test(i.desc)).map((i) => `${i.desc} ${i.total != null ? i.total.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €' : ''}`.trim());
  x.hinweise = [kdnr ? `Kunden-Nr. ${kdnr}` : '', side.length ? `inkl. ${side.join(', ')}` : ''].filter(Boolean).join(' · ') || null;
  x.kunden_nr = kdnr;
  if (!x.preis_netto && !x.modell) return null;
  return x;
}

let avail = null;
/** ist pdftotext installiert? */
function available() {
  if (avail === null) { try { require('child_process').execFileSync('pdftotext', ['-v'], { stdio: 'ignore', timeout: 5000 }); avail = true; } catch { avail = false; } }
  return avail;
}

module.exports = { pdfText, parseText, available };
