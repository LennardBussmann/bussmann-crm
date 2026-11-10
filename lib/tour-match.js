'use strict';
/**
 * Namensliste (z. B. alte Kalendertour) mit den Kunden im CRM abgleichen.
 * Eine Zeile pro Kunde: „Nachname; Vorname; Straße/Ort“ – Vorname und Hinweis sind optional,
 * Trennzeichen ; , oder Tab. Abkürzungen wie „Gr.“ (Große) und „Sch.“ (Schulze) werden erkannt.
 */
const ABBR = { gr: 'grosse', gross: 'grosse', sch: 'schulze', schu: 'schulze', lt: 'luetke', ltke: 'luetke', st: 'sankt' };
const SKIP_FIRST = new Set(['fr', 'frau', 'hr', 'herr', 'familie', 'fam', 'gaertner', 'hof', 'junior', 'senior', 'jun', 'sen']);

function norm(s) {
  return String(s ?? '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map((w) => ABBR[w] || w).join(' ');
}
const squash = (s) => s.replace(/ /g, '');

function parseLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(nachname|name)\b/i.test(l)).slice(0, 400).map((line) => {
    const parts = line.split(/\s*[;\t|]\s*|\s*,\s*/);
    return { line, last: parts[0] || '', first: parts[1] || '', hint: parts.slice(2).join(' ') };
  });
}

function prepare(customers) {
  return customers.map((c) => ({
    c, last: norm(c.last_name), first: norm(c.first_name), company: norm(c.company),
    full: norm(`${c.first_name || ''} ${c.last_name || ''}`), addr: norm(`${c.street || ''} ${c.zip || ''} ${c.city || ''}`), street: norm(c.street),
  }));
}

function score(row, x) {
  const s = norm(row.last); if (!s) return 0;
  const sq = squash(s);
  let sc = 0;
  if (x.last === s || squash(x.last) === sq) sc = 6;
  else if (x.company && (x.company === s || squash(x.company).includes(sq))) sc = 5;
  else if (x.full.includes(s) || squash(x.full).includes(sq)) sc = 4;
  else if (sq.length >= 5 && x.last && (squash(x.last).includes(sq) || sq.includes(squash(x.last)) && x.last.length >= 5)) sc = 3;
  if (!sc) return 0;
  const f = norm(row.first);
  if (f && !SKIP_FIRST.has(f)) {
    const fw = f.split(' ');
    if (x.first === f) sc += 4;
    else if (fw.every((w) => w.length === 1) && x.first && fw[0] === x.first[0]) sc += 2;
    else if (x.first && (x.first.startsWith(f) || f.startsWith(x.first))) sc += 3;
    else if (x.first && fw[0].length > 1) sc -= 3;
  }
  const h = norm(row.hint);
  if (h) {
    const hw = h.split(' ');
    const num = hw.find((w) => /^\d+[a-z]?$/.test(w));
    const words = hw.filter((w) => !/^\d/.test(w));
    if (words.length && words.every((w) => x.addr.includes(w))) sc += num ? (x.street.split(' ').includes(num) ? 6 : 2) : 3;
    else if (num && x.street.split(' ').includes(num)) sc += 1;
  }
  return sc;
}

/** @returns {Array<{line,last,first,hint,status,candidates:[{id,score}],pick}>} */
function matchList(text, customers) {
  const xs = prepare(customers);
  return parseLines(text).map((row) => {
    const cand = xs.map((x) => ({ x, sc: score(row, x) })).filter((r) => r.sc >= 3).sort((a, b) => b.sc - a.sc).slice(0, 6);
    const top = cand[0]; const second = cand[1];
    let status = 'none';
    if (top) status = top.sc >= 6 && (!second || top.sc - second.sc >= 3) ? 'ok' : 'check';
    return { ...row, status, pick: top ? top.x.c.id : null, candidates: cand.map((r) => ({ id: r.x.c.id, score: r.sc })) };
  });
}

module.exports = { matchList, norm, parseLines };
