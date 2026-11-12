/**
 * Öffentliche Maschinenbörse für die Homepage.
 * Zeigt nur Maschinen mit Haken „Auf Homepage zeigen“, die nicht verkauft sind.
 * Interne Daten (EK, Notizen, Vorbesitzer, Seriennummer, Standort) gehen nie nach außen.
 *
 *  /boerse/                 Übersicht (eigene Seite oder per iframe eingebettet, ?embed=1)
 *  /boerse/m/:id            Detailseite einer Maschine
 *  /boerse/machines.json    Daten als JSON (CORS offen) für eigene Einbindungen
 *  /boerse/foto/:id         Foto (nur von öffentlichen Maschinen)
 *  /boerse/embed.js         Einbinde-Skript für die Homepage
 */
const path = require('path');

const COMPANY = { name: 'Bussmann Land- & Gartentechnik', street: 'Hauptstraße 5', city: '48329 Havixbeck', phone: '02507 1294', email: 'info@bussmann-havixbeck.de' };
const VAT = 0.19;
const COND = { neu: 'Neu', vorfuehr: 'Vorführmaschine', gebraucht: 'Gebraucht' };

module.exports = function boerse(app, { get, all, DATA_DIR, PHOTO_TYPES }) {
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const e0 = (n) => Math.round(n).toLocaleString('de-DE') + ' €';
  const PUBLIC_SQL = `SELECT m.* FROM used_machines m WHERE m.public=1 AND m.status<>'verkauft'`;
  // Foto-Nummer mit Dateiendung (WordPress übernimmt Bilder nur mit .jpg/.png/… in der Adresse)
  const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const photosOf = (id) => all('SELECT id, mime FROM used_photos WHERE used_id=? ORDER BY sort, id', id).map((f) => Object.assign(new Number(f.id), { ext: EXT[f.mime] || 'jpg' }));
  const eqList = (s) => String(s || '').split(/\n|,(?=\s)(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  const out = (m) => {
    const price = m.show_price && m.asking_price != null ? m.asking_price : null;
    return {
      id: m.id, nr: `G-${m.id}`, title: [m.brand, m.model].filter(Boolean).join(' ') || m.category || 'Maschine',
      category: m.category || '', brand: m.brand || '', model: m.model || '', year: m.year, hours: m.hours,
      condition: m.condition, condition_label: COND[m.condition] || 'Gebraucht', reserved: m.status === 'reserviert', status: m.status === 'reserviert' ? 'reserviert' : 'verfuegbar', angebotsnr: `G-${m.id}`,
      equipment: eqList(m.equipment), description: m.description || '',
      price_net: price, price_gross: price == null ? null : Math.round(price * (1 + VAT) * 100) / 100,
      photos: photosOf(m.id), updated: m.updated_at,
    };
  };
  const list = () => all(`${PUBLIC_SQL} ORDER BY CASE m.condition WHEN 'neu' THEN 0 ELSE 1 END, m.in_date DESC, m.id DESC`).map(out);
  const base = (req) => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;

  // darf überall eingebettet werden (eigene Homepage), sonst wie der Rest gesichert
  app.use('/boerse', (req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors *");
    res.set('Cache-Control', 'public, max-age=120');
    next();
  });

  app.get('/boerse/machines.json', (req, res) => {
    const b = base(req);
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ company: COMPANY, updated: new Date().toISOString(), machines: list().map((m) => ({ ...m, url: `${b}/boerse/m/${m.id}`, photos: m.photos.map((p) => `${b}/boerse/foto/${p}.${p.ext}`) })) });
  });

  app.get('/boerse/foto/:id', (req, res) => {
    const f = get(`SELECT f.* FROM used_photos f JOIN used_machines m ON m.id=f.used_id WHERE f.id=? AND m.public=1 AND m.status<>'verkauft'`, parseInt(req.params.id, 10) || 0);
    if (!f) return res.status(404).end();
    res.set('Content-Type', PHOTO_TYPES.includes(f.mime) ? f.mime : 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path.join(DATA_DIR, 'files', f.stored_name));
  });

  app.get('/boerse/embed.js', (req, res) => {
    const b = base(req);
    res.type('application/javascript').send(`(function(){
  var s=document.currentScript, box=document.getElementById('bussmann-boerse');
  if(!box){box=document.createElement('div');s.parentNode.insertBefore(box,s);}
  var f=document.createElement('iframe');
  f.src=${JSON.stringify(b + '/boerse/?embed=1')};f.title='Maschinenbörse';f.loading='lazy';
  f.style.cssText='width:100%;border:0;display:block;min-height:600px';
  box.appendChild(f);
  window.addEventListener('message',function(e){
    if(e.source!==f.contentWindow||!e.data||e.data.type!=='bussmann-boerse')return;
    f.style.height=e.data.h+'px';
    if(e.data.nav){var r=f.getBoundingClientRect();if(r.top<0)window.scrollBy(0,r.top-20);}
  });
})();`);
  });

  const CSS = `*{box-sizing:border-box}body{margin:0;font-family:'Nunito Sans',Arial,sans-serif;color:#222;background:#fff;font-size:15px}
a{color:#c0292f}.wrap{max-width:1180px;margin:0 auto;padding:16px}
.hd{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:3px solid #c0292f;padding-bottom:10px;margin-bottom:14px;flex-wrap:wrap}.hd img{height:48px}.hd .c{color:#6a6d6e;font-size:13px;text-align:right}
h1{font-size:26px;margin:4px 0 12px;font-weight:800}
.flt{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.flt button,.flt select,.flt input{font:inherit;font-size:14px;border:1px solid #d5d5d5;background:#fff;border-radius:999px;padding:7px 14px;cursor:pointer}.flt input{cursor:text;flex:1;min-width:160px}.flt button.on{background:#c0292f;color:#fff;border-color:#c0292f}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{display:block;text-decoration:none;color:inherit;border:1px solid #e3e3e3;border-radius:10px;overflow:hidden;background:#fff;transition:box-shadow .15s}.card:hover{box-shadow:0 6px 20px rgba(0,0,0,.1)}
.ph{position:relative;aspect-ratio:4/3;background:#f1f1f1}.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph .no{display:flex;height:100%;align-items:center;justify-content:center;color:#999}
.bd{position:absolute;left:8px;top:8px;display:flex;gap:6px}.bd span{background:#fff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:800}.bd .neu{background:#c0292f;color:#fff}.bd .res{background:#f5b301}
.ci{padding:12px 14px}.ci b{font-size:17px;display:block}.ci .s{color:#6a6d6e;font-size:13px;margin:2px 0 8px}.pr{font-size:19px;font-weight:800;color:#c0292f}.pr small{display:block;font-size:12px;color:#6a6d6e;font-weight:600}
.empty{padding:40px;text-align:center;color:#6a6d6e;border:1px dashed #ccc;border-radius:10px}
.det{display:grid;grid-template-columns:3fr 2fr;gap:24px}.gal .main{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#f1f1f1;display:block}.th{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.th img{width:84px;height:63px;object-fit:cover;border-radius:6px;cursor:pointer;opacity:.75;border:2px solid transparent}.th img.on{opacity:1;border-color:#c0292f}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #eee;vertical-align:top}td:first-child{color:#6a6d6e;width:45%}
h2{font-size:14px;color:#c0292f;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px}ul{margin:0;padding-left:20px}li{margin:3px 0}.desc{white-space:pre-wrap;line-height:1.5}
.pbox{background:#c0292f;color:#fff;border-radius:10px;padding:14px 18px;margin:12px 0}.pbox b{font-size:28px;display:block}.pbox span{font-size:13px;opacity:.92}
.btn{display:inline-block;background:#c0292f;color:#fff;text-decoration:none;font-weight:800;border-radius:8px;padding:10px 16px;margin:4px 6px 4px 0}.btn.o{background:#fff;color:#c0292f;border:2px solid #c0292f}
.back{display:inline-block;margin-bottom:10px;text-decoration:none;font-weight:700}.ft{color:#888;font-size:12px;margin-top:22px}
@media(max-width:760px){.det{grid-template-columns:1fr}.hd .c{text-align:left}}
@media print{.flt,.back,.btn,.th{display:none}.pbox{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  const page = (title, body, embed) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap"><style>${CSS}${embed ? '.wrap{padding:4px}' : ''}</style></head><body><div class="wrap">
${embed ? '' : `<div class="hd"><a href="/boerse/"><img src="/img/logo.png" alt="${h(COMPANY.name)}"></a><div class="c">${h(COMPANY.name)}<br>${h(COMPANY.street)} · ${h(COMPANY.city)}<br>Tel. <a href="tel:${COMPANY.phone.replace(/\s/g, '')}">${h(COMPANY.phone)}</a> · <a href="mailto:${COMPANY.email}">${h(COMPANY.email)}</a></div></div>`}
${body}<div class="ft">Alle Angebote freibleibend, Zwischenverkauf und Irrtümer vorbehalten.</div></div>
<script>(function(){var nav=true;function s(){if(window.parent!==window)parent.postMessage({type:'bussmann-boerse',h:document.documentElement.scrollHeight,nav:nav},'*');nav=false;}window.addEventListener('load',s);window.addEventListener('resize',s);new MutationObserver(s).observe(document.body,{childList:true,subtree:true,attributes:true});setTimeout(s,300);})();</script>
</body></html>`;
  const specs = (m) => [m.year ? 'Bj. ' + m.year : '', m.hours != null && !(m.condition === 'neu' && !m.hours) ? m.hours.toLocaleString('de-DE') + ' Bh' : ''].filter(Boolean).join(' · ');
  const priceHtml = (m) => (m.price_net == null ? '<div class="pr">Preis auf Anfrage</div>' : `<div class="pr">${e0(m.price_net)} <small>netto · ${e0(m.price_gross)} inkl. 19 % MwSt.</small></div>`);

  app.get('/boerse/', (req, res) => {
    const embed = !!req.query.embed; const q = embed ? '?embed=1' : '';
    const ms = list();
    const cats = [...new Set(ms.map((m) => m.category).filter(Boolean))].sort();
    const body = `<h1>Maschinenbörse</h1>
${ms.length ? `<div class="flt"><button class="on" data-c="">Alle (${ms.length})</button>${['neu', 'vorfuehr', 'gebraucht'].filter((c) => ms.some((m) => m.condition === c)).map((c) => `<button data-c="${c}">${c === 'neu' ? 'Neumaschinen' : c === 'vorfuehr' ? 'Vorführmaschinen' : 'Gebrauchte'}</button>`).join('')}
${cats.length > 1 ? `<select id="cat"><option value="">Alle Maschinenarten</option>${cats.map((c) => `<option>${h(c)}</option>`).join('')}</select>` : ''}<input id="q" type="search" placeholder="Suchen …"></div>
<div class="grid" id="grid">${ms.map((m) => `<a class="card" href="/boerse/m/${m.id}${q}" data-c="${m.condition}" data-cat="${h(m.category)}" data-t="${h([m.title, m.category, m.equipment.join(' ')].join(' ').toLowerCase())}">
<div class="ph">${m.photos[0] ? `<img src="/boerse/foto/${m.photos[0]}" alt="${h(m.title)}" loading="lazy">` : '<div class="no">Foto folgt</div>'}<div class="bd"><span class="${m.condition === 'neu' ? 'neu' : ''}">${h(m.condition_label)}</span>${m.reserved ? '<span class="res">Reserviert</span>' : ''}</div></div>
<div class="ci"><b>${h(m.title)}</b><div class="s">${h([m.category, specs(m)].filter(Boolean).join(' · '))}</div>${priceHtml(m)}</div></a>`).join('')}</div>
<div class="empty" id="none" hidden>Keine Maschine passt zu diesem Filter.</div>
<script>(function(){var c='',cat='',q='';function f(){var n=0;document.querySelectorAll('#grid .card').forEach(function(a){var ok=(!c||a.dataset.c===c)&&(!cat||a.dataset.cat===cat)&&(!q||a.dataset.t.indexOf(q)>=0);a.hidden=!ok;if(ok)n++;});document.getElementById('none').hidden=n>0;}
document.querySelectorAll('.flt button').forEach(function(b){b.onclick=function(){c=b.dataset.c;document.querySelectorAll('.flt button').forEach(function(x){x.classList.toggle('on',x===b);});f();};});
var s=document.getElementById('cat');if(s)s.onchange=function(){cat=s.value;f();};document.getElementById('q').oninput=function(e){q=e.target.value.toLowerCase().trim();f();};})();</script>`
      : '<div class="empty">Im Moment sind keine Maschinen eingestellt. Rufen Sie uns gerne an – wir finden die passende Maschine für Sie.</div>'}`;
    res.type('html').send(page('Maschinenbörse – ' + COMPANY.name, body, embed));
  });

  app.get('/boerse/m/:id', (req, res) => {
    const embed = !!req.query.embed; const q = embed ? '?embed=1' : '';
    const m0 = get(`${PUBLIC_SQL} AND m.id=?`, req.params.id);
    if (!m0) return res.status(404).type('html').send(page('Nicht gefunden', `<a class="back" href="/boerse/${q}">‹ Zur Übersicht</a><div class="empty">Diese Maschine ist leider nicht mehr verfügbar.</div>`, embed));
    const m = out(m0);
    const rows = [['Hersteller', m.brand], ['Modell', m.model], ['Maschinenart', m.category], ['Zustand', m.condition_label], ['Baujahr', m.year], ['Betriebsstunden', m.hours != null && !(m.condition === 'neu' && !m.hours) ? m.hours.toLocaleString('de-DE') + ' h' : ''], ['Angebots-Nr.', m.nr]].filter((r) => r[1]);
    const subj = encodeURIComponent(`Anfrage ${m.title} (Nr. ${m.nr})`);
    const body = `<a class="back" href="/boerse/${q}">‹ Alle Maschinen</a>
<div class="det"><div class="gal">${m.photos.length ? `<img class="main" id="big" src="/boerse/foto/${m.photos[0]}" alt="${h(m.title)}">${m.photos.length > 1 ? `<div class="th">${m.photos.map((p, i) => `<img src="/boerse/foto/${p}" alt="" class="${i ? '' : 'on'}" loading="lazy">`).join('')}</div>` : ''}` : '<div class="main" style="display:flex;align-items:center;justify-content:center;color:#999">Foto folgt</div>'}</div>
<div><h1>${h(m.title)}</h1><div style="color:#6a6d6e">${h(m.condition_label)}${m.reserved ? ' · <b style="color:#b07d00">Reserviert</b>' : ''}</div>
${m.price_net == null ? '<div class="pbox"><b>Preis auf Anfrage</b></div>' : `<div class="pbox"><b>${e0(m.price_net)} netto</b><span>${e0(m.price_gross)} inkl. 19 % MwSt. · Finanzierung und Leasing möglich</span></div>`}
<a class="btn" href="tel:${COMPANY.phone.replace(/\s/g, '')}">Anrufen: ${h(COMPANY.phone)}</a><a class="btn o" href="mailto:${COMPANY.email}?subject=${subj}" target="_top">Per E-Mail anfragen</a>
<h2>Technische Daten</h2><table>${rows.map(([k, v]) => `<tr><td>${h(k)}</td><td>${h(v)}</td></tr>`).join('')}</table></div></div>
${m.equipment.length ? `<h2>Ausstattung</h2><ul>${m.equipment.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
${m.description ? `<h2>Beschreibung</h2><div class="desc">${h(m.description)}</div>` : ''}
<script>document.querySelectorAll('.th img').forEach(function(t){t.onclick=function(){document.getElementById('big').src=t.src;document.querySelectorAll('.th img').forEach(function(x){x.classList.toggle('on',x===t);});};});</script>`;
    res.type('html').send(page(`${m.title} – Maschinenbörse ${COMPANY.name}`, body, embed));
  });
};
