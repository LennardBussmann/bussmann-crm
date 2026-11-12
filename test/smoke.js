'use strict';
// Schnelltest der API: startet den Server mit leerer Test-Datenbank und spielt die wichtigsten Abläufe durch.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATA_DIR = dir;
process.env.TZ = 'Europe/Berlin';
const app = require('../server');
const XLSX = require('xlsx');
const L = require('../lib/logic');
const U = require('../lib/util');

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jars = {};
  const call = async (who, method, p, body, raw) => {
    const headers = { 'X-Requested-With': 'crm' };
    if (jars[who]) headers.Cookie = jars[who];
    let b;
    if (raw) { b = body; headers['Content-Type'] = 'application/octet-stream'; } else if (body !== undefined) { b = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers, body: b });
    const sc = r.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await call('a', 'POST', '/api/setup', { name: 'Lennard Bussmann', email: 'admin@test.de', password: 'geheim123' });
    const me = await call('a', 'GET', '/api/me');
    assert.equal(me.user.role, 'admin');
    const kollege = await call('a', 'POST', '/api/users', { name: 'Kai Kollege', email: 'kai@test.de', password: 'geheim123' });
    await call('k', 'POST', '/api/login', { email: 'kai@test.de', password: 'geheim123' });

    const bday = `1980-${U.today().slice(5)}`;
    const { id } = await call('a', 'POST', '/api/customers', { first_name: 'Daniel', last_name: 'Dircks', street: 'Aulendorfer Weg 13', zip: '48727', city: 'Billerbeck', customer_type: 'Landwirt', birthday: bday, email: 'd@example.de', mobile: '0151 14620134', visit_interval: 'quarterly' });
    let d = await call('a', 'GET', `/api/customers/${id}`);
    const visit = d.tasks.find((t) => t.auto_visit);
    assert.ok(visit, 'automatische Besuchsaufgabe fehlt');
    assert.equal(visit.due_date, U.addMonths(U.today(), 3));

    // Besuch mit Folgeaufgabe an Kollegen
    await call('a', 'POST', `/api/customers/${id}/entries`, { kind: 'besuch', text: 'Hofbesuch, Interesse an Mähwerk', happened_at: U.nowLocal(), tasks: [{ kind: 'angebot', title: 'Angebot Mähwerk', due_date: U.addDays(U.today(), 1), assigned_to: kollege.id }] });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.equal(d.entries.filter((e) => e.kind === 'besuch').length, 1);
    const offer = d.tasks.find((t) => t.kind === 'angebot');
    assert.equal(offer.assigned_to, kollege.id);
    const notes = await call('k', 'GET', '/api/notifications');
    assert.ok(notes.some((n) => n.text.includes('Angebot Mähwerk')), 'Kollege nicht benachrichtigt');
    const kTasks = await call('k', 'GET', '/api/tasks?scope=mine&status=open');
    assert.equal(kTasks.length, 1);

    // Erinnerung einen Tag vorher
    await L.runReminders();
    const notes2 = await call('k', 'GET', '/api/notifications');
    assert.ok(notes2.some((n) => n.text.startsWith('Erinnerung')), 'Erinnerung fehlt');

    // Bild an Aufgabe
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await call('k', 'POST', `/api/tasks/${offer.id}/files`, png, true);
    let td = await call('a', 'GET', `/api/tasks/${offer.id}`);
    assert.equal(td.files.length, 1);
    assert.equal((await call('a', 'GET', '/api/tasks?scope=all&status=open')).find((x) => x.id === offer.id).file_count, 1);
    const img = await fetch(`${base}/api/task-files/${up.id}`, { headers: { Cookie: jars.a } });
    assert.equal(img.status, 200);
    await call('a', 'DELETE', `/api/task-files/${up.id}`);
    td = await call('a', 'GET', `/api/tasks/${offer.id}`);
    assert.equal(td.files.length, 0);

    // Infofeld
    await call('a', 'PUT', `/api/customers/${id}/info`, { info: 'Zahlt immer bar' });
    // Erledigen -> Zeitleiste
    await call('k', 'POST', `/api/tasks/${offer.id}/done`, { note: 'Per Mail verschickt' });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.equal(d.customer.info, 'Zahlt immer bar');
    assert.ok(d.entries.some((e) => e.text.includes('Per Mail verschickt')));
    // Änderungsprotokoll
    await call('k', 'PUT', `/api/customers/${id}`, { phone: '02543 1234' });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.ok(d.entries.some((e) => e.kind === 'system' && e.text.includes('Festnetznummer') && e.author === 'Kai Kollege'));

    // Dashboard + Geburtstag
    const dash = await call('a', 'GET', '/api/dashboard?scope=all');
    assert.ok(dash.birthdaysUpcoming.some((b) => b.id === id), 'Geburtstag fehlt');
    assert.ok(dash.week.length >= 0);

    // Suche
    assert.equal((await call('a', 'GET', '/api/customers?q=billerbeck')).rows.length, 1);
    assert.equal((await call('a', 'GET', '/api/customers?q=0151146')).rows.length, 1);
    assert.equal((await call('a', 'GET', '/api/customers?q=xyz')).rows.length, 0);

    // Excel-Import
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Vorname', 'Nachname', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall'],
      ['Anna', 'Schulte', 'Dorfstr. 2', 48727, 'Billerbeck', 'Forst', '03.04.1975', 'anna@x.de', '0170 111', '02541 222', 'Jährlich'],
      ['Gemeinde', 'Nottuln', '', '48301', 'Nottuln', 'Kommune', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['Daniel', 'Dircks', '', '48727', '', '', '', '', '', '', ''],
      ['ohne', '', '', '', '', '', '', '', '', '', ''],
    ]), 'Kunden');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const prev = await call('a', 'POST', '/api/import/preview', buf, true);
    assert.equal(prev.rows.length, 4);
    assert.equal(prev.rows[0].birthday, '1975-04-03');
    assert.equal(prev.rows[0].visit_interval, 'yearly');
    assert.equal(prev.rows[0].zip, '48727');
    assert.ok(prev.rows[2]._duplicate, 'Dublette nicht erkannt');
    assert.equal(prev.rows[3]._error, 'Nachname fehlt');
    const imp = await call('a', 'POST', '/api/import/commit', { rows: prev.rows.filter((r) => !r._error && !r._duplicate) });
    assert.equal(imp.created, 2);

    // Doppelte Zeilen zusammenführen + vorhandene ergänzen
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
      ['Vorname', 'Nachname', 'PLZ', 'Ort', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Info'],
      ['Karl', 'Müller', '48727', 'Billerbeck', '', '0171 555', '', 'Fendt 211'],
      ['Karl', 'Mueller', '48727', '', 'karl@x.de', '+49 171 555', '02543 9', ''],
      ['', 'Weber', '', '', 'karl@x.de', '', '', ''],
      ['Daniel', 'Dircks', '48727', '', 'neu@dircks.de', '', '', 'Hat Hund'],
    ]), 'K');
    const prev2 = await call('a', 'POST', '/api/import/preview', XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }), true);
    assert.equal(prev2.total, 4);
    assert.equal(prev2.rows.length, 3, 'Zeilen falsch zusammengefasst');
    assert.equal(prev2.rows[0]._count, 2);
    assert.equal(prev2.rows[1].last_name, 'Weber');
    assert.equal(prev2.rows[0].city, 'Billerbeck');
    assert.equal(prev2.rows[0].email, 'karl@x.de');
    assert.equal(prev2.rows[0].phone, '02543 9');
    assert.equal(prev2.rows[2]._duplicate, id);
    const r2 = await call('a', 'POST', '/api/import/commit', { rows: prev2.rows, dupMode: 'merge' });
    assert.equal(r2.created, 2); assert.equal(r2.updated, 1);
    const dd = (await call('a', 'GET', `/api/customers/${id}`)).customer;
    assert.equal(dd.email, 'd@example.de', 'vorhandene E-Mail überschrieben');
    assert.ok(dd.info.includes('Hat Hund') && dd.info.includes('neu@dircks.de'));
    assert.equal((await call('a', 'GET', '/api/customers?q=' + encodeURIComponent('Karl Müller'))).rows.length, 1);

    // CSV aus Excel (Windows-1252, Semikolon)
    const csv = Buffer.from('Vorname;Nachname;Ort\r\nJ\xfcrgen;M\xfcller;L\xfcnen\r\n', 'latin1');
    const pc = await call('a', 'POST', '/api/import/preview', csv, true);
    assert.equal(pc.rows[0].first_name, 'Jürgen');
    assert.equal(pc.rows[0].city, 'Lünen');
    // Mehrfach löschen
    const ids = (await call('a', 'GET', '/api/customers?q=schulte')).rows.map((r) => r.id);
    assert.equal((await call('a', 'POST', '/api/customers/bulk-delete', { ids })).deleted, ids.length);
    await assert.rejects(call('k', 'POST', '/api/customers/bulk-delete', { ids: [id] }), /403/);

    // Kaufender Kunde / Interessent, Filter, Kontakt-Reiter
    const lead = (await call('a', 'POST', '/api/customers', { first_name: 'Ina', last_name: 'Interessent', city: 'Coesfeld', customer_type: 'Gartenbau' })).id;
    const buyer = (await call('a', 'POST', '/api/customers', { first_name: 'Karl', last_name: 'Käufer', city: 'Coesfeld', customer_type: 'Landwirt', is_buyer: true })).id;
    let cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=lead');
    assert.deepEqual(cl.rows.map((r) => r.id), [lead]);
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=buyer');
    assert.deepEqual(cl.rows.map((r) => r.id), [buyer]);
    assert.equal((await call('a', 'GET', '/api/customers?q=Coesfeld&type=Gartenbau')).rows.length, 1);
    await call('a', 'PUT', `/api/customers/${lead}`, { is_buyer: true });
    assert.equal((await call('a', 'GET', '/api/customers?q=Coesfeld&status=buyer')).rows.length, 2);
    await call('k', 'POST', '/api/customers/bulk-update', { ids: [lead, buyer], is_buyer: false, customer_type: 'Forst' });
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=lead&type=Forst');
    assert.equal(cl.rows.length, 2);
    // Kontakt: Karl vor 2 Monaten, Ina nie
    await call('a', 'POST', `/api/customers/${buyer}/entries`, { kind: 'telefonat', text: 'Telefonat', happened_at: U.addMonths(U.today(), -2) + 'T10:00' });
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&contact=m3');
    assert.deepEqual(cl.rows.map((r) => r.id), [buyer]);
    assert.equal(cl.counts.all, 2); assert.equal(cl.counts.m3, 1); assert.equal(cl.counts.old, 1); assert.equal(cl.counts.m1, 0);
    assert.deepEqual((await call('a', 'GET', '/api/customers?q=Coesfeld&contact=old')).rows.map((r) => r.id), [lead]);
    // Import mit Status-Spalte
    const ws3 = XLSX.utils.aoa_to_sheet([['Vorname', 'Nachname', 'Ort', 'Kundenart', 'Status'], ['Gerd', 'Gärtner', 'Nottuln', 'GaLaBau', 'Kunde'], ['Lea', 'Leer', 'Nottuln', '', 'Interessent']]);
    const wb3 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb3, ws3, "K");
    const pv3 = await call('a', 'POST', '/api/import/preview', XLSX.write(wb3, { type: 'buffer', bookType: 'xlsx' }), true);
    assert.equal(pv3.rows[0].is_buyer, 1); assert.equal(pv3.rows[0].customer_type, 'Gartenbau'); assert.equal(pv3.rows[1].is_buyer, 0);

    // Termin mit weiteren Teilnehmern
    const third = await call('a', 'POST', '/api/users', { name: 'Tina Dritte', email: 'tina@test.de', password: 'geheim123' });
    await call('t', 'POST', '/api/login', { email: 'tina@test.de', password: 'geheim123' });
    const tid = (await call('a', 'POST', '/api/tasks', { kind: 'termin', title: 'Vorführung Mähwerk', due_date: U.addDays(U.today(), 3), due_time: '10:00', customer_id: buyer, participants: [kollege.id, third.id, me.user.id] })).id;
    assert.deepEqual((await call('a', 'GET', '/api/customers?q=Coesfeld&contact=m1')).rows.map((r) => r.id), [buyer], 'neue Aufgabe zählt als Kontakt');
    let tk = await call('a', 'GET', `/api/tasks/${tid}`);
    assert.equal(tk.assigned_to, me.user.id);
    assert.deepEqual(tk.participant_ids.split(',').map(Number).sort(), [kollege.id, third.id].sort(), 'Zuständiger darf nicht doppelt Teilnehmer sein');
    assert.ok((await call('t', 'GET', '/api/notifications')).some((n) => n.text.includes('eingeladen') && n.text.includes('Vorführung')));
    assert.ok((await call('t', 'GET', '/api/tasks?scope=mine&status=open')).some((t) => t.id === tid), 'Teilnehmer sieht Termin nicht');
    const tcal = await call('t', 'GET', `/api/calendar?from=${U.today()}&to=${U.addDays(U.today(), 7)}`);
    assert.ok(tcal.tasks.some((t) => t.id === tid));
    const tdash = await call('t', 'GET', '/api/dashboard');
    assert.ok(tdash.open.some((t) => t.id === tid));
    const tFeed = await (await fetch(base + new URL((await call('t', 'GET', '/api/me/ical')).https).pathname)).text();
    assert.ok(tFeed.includes('Vorführung Mähwerk'), 'Teilnehmer-Kalender fehlt Termin');
    await call('a', 'PUT', `/api/tasks/${tid}`, { participants: [third.id] });
    tk = await call('a', 'GET', `/api/tasks/${tid}`);
    assert.equal(tk.participant_ids, String(third.id));
    assert.ok(!(await call('k', 'GET', '/api/tasks?scope=mine&status=open')).some((t) => t.id === tid));
    // Folgeaufgabe aus Zeitleiste mit Teilnehmer
    const fu = await call('a', 'POST', `/api/customers/${buyer}/entries`, { kind: 'besuch', text: 'Besuch', tasks: [{ kind: 'besuch', title: 'Zweiter Besuch', due_date: U.addDays(U.today(), 9), assigned_to: kollege.id, participants: [third.id] }] });
    assert.equal((await call('t', 'GET', `/api/tasks/${fu.taskIds[0]}`)).participant_names, 'Tina Dritte');

    // Schlagworte
    await call('a', 'PUT', `/api/customers/${buyer}`, { tags: 'Messe 2026, Mähroboter' });
    assert.deepEqual((await call('a', 'GET', '/api/customers?tag=' + encodeURIComponent('Messe 2026'))).rows.map((r) => r.id), [buyer]);
    await call('a', 'POST', '/api/customers/bulk-update', { ids: [lead, buyer], add_tag: 'Messe 2026' });
    assert.equal((await call('a', 'GET', '/api/customers?tag=' + encodeURIComponent('messe 2026'))).rows.length, 2);
    await call('a', 'POST', '/api/customers/bulk-update', { ids: [buyer], remove_tag: 'Mähroboter' });
    const meta = await call('a', 'GET', '/api/meta');
    assert.deepEqual(meta.tags, [{ tag: 'Messe 2026', n: 2 }]);

    // Maschinen + Wartungserinnerung
    const mid = (await call('a', 'POST', `/api/customers/${buyer}/machines`, { category: 'Rasentraktor', brand: 'Husqvarna', model: 'TS 142', serial: 'HQ-4711', year: 2021, sold_by_us: true, service_interval: 'yearly', next_service: U.addDays(U.today(), 1) })).id;
    let cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.machines.length, 1);
    const svc = cd.tasks.find((t) => t.kind === 'wartung' && t.status === 'open');
    assert.ok(svc && svc.due_date === U.addDays(U.today(), 1) && svc.machine_id === mid, 'Wartungsaufgabe fehlt');
    assert.equal((await call('a', 'GET', '/api/customers?q=HQ-4711')).rows[0].id, buyer, 'Suche nach Seriennummer');
    assert.ok((await call('a', 'GET', '/api/customers?extra=service_due')).rows.some((r) => r.id === buyer));
    await call('a', 'POST', `/api/tasks/${svc.id}/done`, { note: 'Messer geschliffen' });
    cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.machines[0].last_service, U.today());
    assert.equal(cd.machines[0].next_service, U.addMonths(U.today(), 12));
    assert.equal(cd.tasks.filter((t) => t.kind === 'wartung' && t.status === 'open').length, 1, 'nächste Wartung nicht geplant');
    await call('a', 'PUT', `/api/machines/${mid}`, { next_service: '', service_interval: '' });
    cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.tasks.filter((t) => t.kind === 'wartung' && t.status === 'open').length, 0);
    await call('a', 'DELETE', `/api/machines/${mid}`);
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).machines.length, 0);

    // Karte / Verortung (Geocoder simuliert)
    const geo = require('../lib/geo');
    const fakeFetch = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('street=') ? [] : [{ lat: '51.97', lon: '7.17' }]) });
    for (let i = 0; i < 50 && await geo.geocodeNext(fakeFetch); i++);
    const mp = await call('a', 'GET', '/api/map?q=Coesfeld');
    assert.equal(mp.points.length, 2); assert.equal(mp.points[0].geo, 'approx'); assert.equal(mp.pending, 0);
    await call('a', 'PUT', `/api/customers/${buyer}/geo`, { lat: 51.98, lng: 7.2 });
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).customer.geo_status, 'manual');
    await call('a', 'PUT', `/api/customers/${buyer}`, { street: 'Neue Straße 1' });
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).customer.geo_status, '', 'Adressänderung muss neu verorten');

    // Maschinen-Import
    await call('a', 'POST', '/api/customers', { first_name: 'Hans', last_name: 'Doppel', zip: '48727', city: 'Billerbeck' });
    await call('a', 'POST', '/api/customers', { first_name: 'Hans', last_name: 'Doppel', zip: '48653', city: 'Coesfeld' });
    const mws = XLSX.utils.aoa_to_sheet([
      ['Kunde', 'Ort', 'Hersteller', 'Typ', 'Fgst-Nr.', 'BJ', 'Kaufdatum', 'Bei uns gekauft', 'Wartungsintervall', 'Letzte Wartung', 'Betriebsstunden'],
      ['Karl Käufer', '', 'Stihl', 'MS 261', 'ST-1', 2022, '01.03.2022', 'ja', 'Jährlich', U.addMonths(U.today(), -11).split('-').reverse().join('.'), 55],
      ['Käufer Karl', '', 'Husqvarna', 'Automower 435X', 'HU-9', 2023, '', '', '', '', ''],
      ['Hans Doppel', 'Coesfeld', 'Kubota', 'L1-382', 'KB-77', 2018, '', '', '', '', ''],
      ['Hans Doppel', '', 'John Deere', 'X350', 'JD-1', 2020, '', '', '', '', ''],
      ['Neu Kunde', 'Havixbeck', 'Kärcher', 'KM 70', '', '', '', '', '', '', ''],
      ['Karl Käufer', '', 'Stihl', 'MS 261', 'st 1', '', '', '', '', '', 'Kette neu'],
    ]);
    const mwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(mwb, mws, 'M');
    const mpv = await call('a', 'POST', '/api/import/machines/preview', XLSX.write(mwb, { type: 'buffer', bookType: 'xlsx' }), true);
    assert.equal(mpv.rows[0].customer_id, buyer, 'Name-Zuordnung');
    assert.equal(mpv.rows[1].customer_id, buyer, 'Nachname Vorname');
    assert.ok(mpv.rows[2].customer_id && mpv.rows[2]._customer_name.includes('Coesfeld'), 'Ort trennt Namensgleiche');
    assert.equal(mpv.rows[3]._candidates.length, 2, 'mehrdeutig');
    assert.ok(!mpv.rows[4].customer_id && !mpv.rows[4]._candidates, 'unbekannt');
    assert.equal(mpv.rows[0].serial, 'ST-1'); assert.equal(mpv.rows[0].year, 2022); assert.equal(mpv.rows[0].sold_by_us, 1);
    mpv.rows[3].customer_id = mpv.rows[3]._candidates[0].id;
    const mres = await call('a', 'POST', '/api/import/machines/commit', { rows: mpv.rows, createMissing: true });
    assert.equal(mres.created, 5); assert.equal(mres.updated, 1, 'gleiche Seriennummer wird ergänzt'); assert.equal(mres.newCustomers, 1);
    const bm = (await call('a', 'GET', `/api/customers/${buyer}`)).machines;
    assert.equal(bm.length, 2);
    const saw = bm.find((x) => x.serial === 'ST-1');
    assert.equal(saw.next_service, U.addMonths(U.today(), 1), 'nächste Wartung aus letzter Wartung + Intervall');
    assert.ok(saw.notes.includes('Betriebsstunden: 55'));
    assert.equal((await call('a', 'GET', '/api/customers?q=KM%2070')).rows[0].last_name, 'Kunde');
    // erneuter Import (ohne Seriennummer, jetzt mit Gerätetyp) verdoppelt nicht
    const kmCust = (await call('a', 'GET', '/api/customers?q=KM%2070')).rows[0].id;
    const rws = XLSX.utils.aoa_to_sheet([['Kunde', 'Ort', 'Hersteller', 'Typ', 'Art'], ['Neu Kunde', 'Havixbeck', 'Kärcher', 'KM 70', 'Kehrmaschine']]);
    const rwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(rwb, rws, 'M');
    const rpv = await call('a', 'POST', '/api/import/machines/preview', XLSX.write(rwb, { type: 'buffer', bookType: 'xlsx' }), true);
    const rres = await call('a', 'POST', '/api/import/machines/commit', { rows: rpv.rows });
    assert.equal(rres.created, 0, 'Re-Import legt nichts doppelt an'); assert.equal(rres.updated, 1);
    assert.equal((await call('a', 'GET', `/api/customers/${kmCust}`)).customer?.is_buyer ?? (await call('a', 'GET', `/api/customers/${kmCust}`)).is_buyer, 1, 'Kunde mit Maschine = kaufend');
    let km = (await call('a', 'GET', `/api/customers/${kmCust}`)).machines;
    assert.equal(km.length, 1); assert.equal(km[0].category, 'Kehrmaschine');
    // vorhandene Doppelte zusammenführen
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Kärcher', model: 'KM 70', service_interval: 'yearly', last_service: U.addMonths(U.today(), -2) });
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Kärcher', model: 'KM 70', notes: 'Bürste neu' });
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Stihl', model: 'MS 261' });
    const dup = await call('a', 'GET', '/api/machines/duplicates');
    assert.equal(dup.machines, 2, 'zwei Doppelte'); assert.equal(dup.groups, 1);
    const ddr = await call('a', 'POST', '/api/machines/dedupe', {});
    assert.equal(ddr.removed, 2);
    km = (await call('a', 'GET', `/api/customers/${kmCust}`)).machines;
    assert.equal(km.length, 2);
    const k = km.find((x) => x.model === 'KM 70');
    assert.equal(k.category, 'Kehrmaschine'); assert.equal(k.service_interval, 'yearly'); assert.ok((k.notes || '').includes('Bürste neu'));
    assert.equal((await call('a', 'GET', '/api/machines/duplicates')).machines, 0);
    // nur Marke (erster Import) + Marke mit Gerätetyp/Seriennr. (zweiter Import) = gleiche Maschine
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Vogelsang' });
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Vogelsang', category: 'VX136-105 Q', serial: 'BJB.3118.2881' });
    // nur Marke, aber zwei verschiedene Maschinen dieser Marke -> unklar, bleibt stehen
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Glanemann' });
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Glanemann', category: 'Offener Kasten', serial: 'GL1' });
    await call('a', 'POST', `/api/customers/${kmCust}/machines`, { brand: 'Glanemann', category: 'Abrollkipper', serial: 'GL2' });
    assert.equal((await call('a', 'GET', '/api/machines/duplicates')).machines, 1);
    await call('a', 'POST', '/api/machines/dedupe', {});
    km = (await call('a', 'GET', `/api/customers/${kmCust}`)).machines;
    const vg = km.filter((x) => x.brand === 'Vogelsang');
    assert.equal(vg.length, 1); assert.equal(vg[0].serial, 'BJB.3118.2881'); assert.equal(vg[0].category, 'VX136-105 Q');
    assert.equal(km.filter((x) => x.brand === 'Glanemann').length, 3);

    // Verkäufe & Einkäufe
    const scust = (await call('a', 'POST', '/api/customers', { first_name: 'Vera', last_name: 'Verkauf', city: 'Nottuln' })).id;
    const buy = await call('k', 'POST', '/api/sales', { kind: 'einkauf', condition: 'gebraucht', brand: 'Fendt', model: '211 Vario', serial: 'F-9', purchase_price: '30.000,00', party: 'Hof Meier' });
    await assert.rejects(call('k', 'POST', '/api/sales', { kind: 'verkauf', brand: 'Stihl' }), /Verkaufspreis/);
    const sale1 = await call('k', 'POST', '/api/sales', { kind: 'verkauf', purchase_id: buy.id, brand: 'Fendt', model: '211 Vario', serial: 'F-9', sale_price: '36.500', extra_costs: '500,00', customer_id: scust });
    await call('a', 'POST', '/api/sales', { kind: 'verkauf', brand: 'Husqvarna', model: 'TS 142', purchase_price: 1800, sale_price: '2.400,00', customer_id: scust, user_id: kollege.id });
    await call('a', 'POST', '/api/sales', { kind: 'verkauf', brand: 'Stihl', model: 'MS 261', purchase_price: 600, sale_price: 800, date: U.addMonths(U.today(), -2) });
    const mon = U.today().slice(0, 8);
    const sl = await call('a', 'GET', `/api/sales?from=${mon}01&to=${mon}31`);
    assert.equal(sl.summary.sales, 2); assert.equal(sl.summary.revenue, 38900); assert.equal(sl.summary.margin, 6000 + 600);
    assert.equal(sl.summary.purchases, 1); assert.equal(sl.summary.purchase_sum, 30000);
    assert.equal(sl.rows.find((r) => r.id === sale1.id).purchase_price, 30000, 'EK aus Lager übernommen');
    assert.equal(sl.stock.length, 0, 'verkaufter Einkauf ist nicht mehr im Lager');
    assert.equal(sl.byUser.find((u) => u.user_id === kollege.id).margin, 6600);
    const vm = (await call('a', 'GET', `/api/customers/${scust}`));
    assert.equal(vm.machines.length, 2); assert.ok(vm.machines.every((m) => m.sold_by_us)); assert.equal((vm.customer || vm).is_buyer, 1);
    // Mitarbeiter sieht nur eigene, Admin-Eintrag nicht änderbar
    const own = await call('k', 'GET', '/api/sales?from=2000-01-01&to=2100-01-01');
    assert.equal(own.rows.length, 3); assert.equal(own.byUser.length, 0);
    const adminSale = (await call('a', 'GET', '/api/sales?from=2000-01-01&to=2100-01-01')).rows.find((r) => r.brand === 'Stihl');
    await assert.rejects(call('k', 'PUT', `/api/sales/${adminSale.id}`, { sale_price: 1 }), /404/);
    const xl = await fetch(`${base}/api/sales/export.xlsx?from=${mon}01&to=${mon}31`, { headers: { Cookie: jars.a } });
    const xwb = XLSX.read(Buffer.from(await xl.arrayBuffer()));
    const xrows = XLSX.utils.sheet_to_json(xwb.Sheets[xwb.SheetNames[0]], { header: 1 });
    assert.equal(xrows[0][14], 'Deckungsbeitrag'); assert.equal(xrows.length, 1 + 3 + 3);
    const rep = await call('a', 'GET', `/api/sales/report.html?from=${mon}01&to=${mon}31`);
    assert.ok(rep.includes('Verkaufsbericht') && rep.includes('36.500,00 €') && rep.includes('Fendt 211 Vario'));

    // Verkaufsprojekte
    await assert.rejects(call('a', 'POST', '/api/projects', { kunde: 'X' }), /Marke/);
    const pr1 = (await call('a', 'POST', '/api/projects', { customer_id: scust, brand: 'Weidemann', typ: 'Hoftrac', modell: '1390', status: 'Angebot erstellt', preis: '42.000', inz_wert: '8.000', inzahlung: 'Weidemann 1140 Bj. 2012', naechster: 'Angebot nachfassen', faellig: U.addDays(U.today(), -1), user_id: kollege.id })).id;
    const pr2 = (await call('k', 'POST', '/api/projects', { kunde: 'Hof Neu', ort: 'Darup', brand: 'Massey Ferguson', typ: 'Traktor', modell: '5S.145', status: 'Verhandlung', preis: 98000, faellig: U.addDays(U.today(), 3) })).id;
    const pr3 = (await call('a', 'POST', '/api/projects', { kunde: 'Hof Alt', brand: 'Weidemann', status: 'Verloren', preis: 30000 })).id;
    let pl = await call('a', 'GET', '/api/projects');
    assert.equal(pl.rows.length, 2, 'nur offene'); assert.equal(pl.stats.open, 2); assert.equal(pl.stats.volume, 140000);
    assert.equal(pl.stats.weighted, 42000 * 0.5 + 98000 * 0.75); assert.equal(pl.stats.overdue, 1); assert.equal(pl.stats.soon, 1); assert.equal(pl.stats.quote, 0);
    assert.equal(pl.rows.find((r) => r.id === pr1).ampel, 'rot'); assert.equal(pl.rows.find((r) => r.id === pr2).kunde_name, 'Hof Neu');
    assert.equal((await call('a', 'GET', '/api/projects?brand=Massey%20Ferguson')).rows.length, 1);
    assert.equal((await call('a', 'GET', '/api/projects?status=*')).rows.length, 3);
    // Wiedervorlage als Aufgabe beim Verkäufer
    let ptask = (await call('k', 'GET', '/api/tasks?scope=mine&status=open')).find((t) => t.project_id === pr1);
    assert.ok(ptask && ptask.title.includes('Angebot nachfassen') && ptask.customer_id === scust);
    await call('a', 'PUT', `/api/projects/${pr1}`, { faellig: U.addDays(U.today(), 10) });
    ptask = (await call('k', 'GET', '/api/tasks?scope=mine&status=open')).find((t) => t.project_id === pr1);
    assert.equal(ptask.due_date, U.addDays(U.today(), 10));
    await call('a', 'PUT', `/api/projects/${pr1}`, { status: 'Gewonnen' });
    assert.ok(!(await call('k', 'GET', '/api/tasks?scope=mine&status=open')).some((t) => t.project_id === pr1), 'Gewonnen -> Wiedervorlage entfällt');
    pl = await call('a', 'GET', '/api/projects?status=*');
    assert.equal(pl.stats.won, 1); assert.equal(pl.stats.quote, 50);
    // Gewonnen -> automatisch Verkauf + Inzahlungnahme als Einkauf
    let auto = (await call('a', 'GET', '/api/sales?from=2000-01-01&to=2100-01-01')).rows.filter((r) => r.project_id === pr1);
    assert.equal(auto.length, 2);
    const av = auto.find((r) => r.kind === 'verkauf'); const ae = auto.find((r) => r.kind === 'einkauf');
    assert.equal(av.sale_price, 42000); assert.equal(av.purchase_price, null); assert.equal(av.user_id, kollege.id); assert.equal(av.customer_id, scust); assert.equal(av.brand, 'Weidemann');
    assert.equal(ae.purchase_price, 8000); assert.ok(ae.model.includes('1140'));
    assert.equal((await call('a', 'GET', `/api/projects/${pr1}`)).sale_id, av.id);
    await call('a', 'PUT', `/api/projects/${pr1}`, { notizen: 'x' });
    assert.equal((await call('a', 'GET', '/api/sales?from=2000-01-01&to=2100-01-01')).rows.filter((r) => r.project_id === pr1).length, 2, 'nicht doppelt');
    await call('a', 'PUT', `/api/projects/${pr1}`, { status: 'Verhandlung' });
    assert.equal((await call('a', 'GET', '/api/sales?from=2000-01-01&to=2100-01-01')).rows.filter((r) => r.project_id === pr1).length, 0, 'zurückgesetzt -> entfernt');
    await call('a', 'PUT', `/api/projects/${pr1}`, { status: 'Gewonnen' });
    assert.equal((await call('a', 'GET', `/api/customers/${scust}`)).projects.length, 1);
    assert.ok((await call('a', 'GET', '/api/projects/report.html?status=*')).includes('Massey Ferguson'));
    await assert.rejects(call('k', 'DELETE', `/api/projects/${pr3}`), /403/);
    await call('k', 'DELETE', `/api/projects/${pr2}`);

    // Gespeicherte Touren je Benutzer
    const t1 = await call('a', 'POST', '/api/tours', { name: 'Dienstag Billerbeck', stops: [id, scust, id, 999999] });
    assert.deepEqual(t1.stops.map((c) => c.id), [id, scust]); // doppelte entfernt, unbekannte ignoriert
    await assert.rejects(call('a', 'POST', '/api/tours', { name: 'leer', stops: [] }), /Stationen/);
    await assert.rejects(call('a', 'POST', '/api/tours', { name: '', stops: [id] }), /Namen/);
    assert.equal((await call('k', 'GET', '/api/tours')).length, 0); // Kollege sieht fremde Touren nicht
    await assert.rejects(call('k', 'PUT', `/api/tours/${t1.id}`, { name: 'x' }), /404/);
    await assert.rejects(call('k', 'DELETE', `/api/tours/${t1.id}`), /404/);
    const t1b = await call('a', 'PUT', `/api/tours/${t1.id}`, { stops: [scust, id] });
    assert.equal(t1b.name, 'Dienstag Billerbeck'); assert.deepEqual(t1b.stops.map((c) => c.id), [scust, id]);
    const tm = (await call('a', 'POST', '/api/tours/match', { text: 'Nachname; Vorname\nDircks; Daniel\nDircks; ; Aulendorfer Weg 13\nGibtsNicht; Hans' })).rows;
    assert.equal(tm.length, 3); // Kopfzeile übersprungen
    assert.equal(tm[0].status, 'ok'); assert.equal(tm[0].pick, id);
    assert.equal(tm[1].pick, id); assert.equal(tm[2].status, 'none'); assert.equal(tm[2].pick, null);
    await assert.rejects(call('a', 'POST', '/api/tours/match', { text: ' ' }), /Liste/);
    {
      const XL = require('xlsx');
      const wb = XL.utils.book_new();
      XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Kalendertour 2026'], ['Nr', 'Vorname', 'Nachname', 'Straße', 'Ort'], [1, 'Daniel', 'Dircks', 'Aulendorfer Weg 13', 'Billerbeck'], [2, '', 'GibtsNicht', '', ''], [3, '', '', '', '']]), 'Tour');
      const xr = await fetch(base + '/api/tours/excel', { method: 'POST', headers: { 'X-Requested-With': 'crm', Cookie: jars.a, 'Content-Type': 'application/octet-stream' }, body: XL.write(wb, { type: 'buffer', bookType: 'xlsx' }) }).then((r) => r.json());
      assert.equal(xr.count, 2); assert.equal(xr.text.split('\n')[0], 'Dircks; Daniel; Aulendorfer Weg 13 Billerbeck');
      const xm = (await call('a', 'POST', '/api/tours/match', { text: xr.text })).rows;
      assert.equal(xm[0].status, 'ok'); assert.equal(xm[1].status, 'none');
      const bad = await fetch(base + '/api/tours/excel', { method: 'POST', headers: { 'X-Requested-With': 'crm', Cookie: jars.a, 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(0) });
      assert.equal(bad.status, 400);
    }
    await call('k', 'POST', '/api/tours', { name: 'Kais Tour', stops: [id] });
    assert.equal((await call('a', 'GET', `/api/tours?user=${kollege.id}`)).length, 1); // Benutzer auswählen
    await assert.rejects(call('k', 'POST', '/api/tours', { name: 'fremd', stops: [id], user_id: me.user.id }), /403/);
    const tkai = await call('a', 'POST', '/api/tours', { name: 'Für Kai', stops: [id], user_id: kollege.id }); // Admin plant für Kollegen
    assert.equal((await call('k', 'GET', '/api/tours')).length, 2);
    await call('a', 'DELETE', `/api/tours/${tkai.id}`);
    assert.equal((await call('a', 'GET', '/api/tours')).length, 1);
    await call('a', 'DELETE', `/api/tours/${t1.id}`);
    assert.equal((await call('a', 'GET', '/api/tours')).length, 0);

    // Gebrauchtmaschinen & Suchaufträge
    const sr1 = await call('a', 'POST', '/api/searches', { customer_id: id, category: 'Hoftrac', brand: 'Weidemann', max_price: '30.000', min_year: 2015, user_id: kollege.id });
    assert.equal(sr1.matches.length, 0);
    await assert.rejects(call('a', 'POST', '/api/searches', { customer_id: id }), /gesucht/);
    const srOther = await call('a', 'POST', '/api/searches', { kunde: 'Hof Test', category: 'Traktor' });
    const nBefore = (await call('k', 'GET', '/api/notifications')).length;
    const st0 = (await call('a', 'GET', '/api/used')).stats;
    const um1 = await call('a', 'POST', '/api/used', { category: 'Hoftrac', brand: 'Weidemann', model: '1390', year: 2018, hours: '2.300', purchase_price: '18.000', asking_price: '26.900', in_date: U.addDays(U.today(), -200) });
    assert.equal(um1.hits, 1); // passt zu sr1, nicht zu srOther
    const nk = await call('k', 'GET', '/api/notifications');
    assert.equal(nk.length, nBefore + 1); assert.match(nk[0].text, /Weidemann 1390/); assert.equal(nk[0].link, `#/gebrauchte/${um1.id}`);
    assert.ok((await call('k', 'GET', `/api/tasks/${nk[0].task_id}`)).title.includes('Kunde informieren'));
    assert.equal((await call('a', 'PUT', `/api/used/${um1.id}`, { asking_price: '27.500' })).hits, 0); // keine doppelte Meldung
    const um2 = await call('a', 'POST', '/api/used', { category: 'Hoftrac', brand: 'Weidemann', model: '1140', year: 2010, asking_price: '12.000' });
    assert.equal(um2.hits, 0); // Baujahr zu alt
    const ul = await call('a', 'GET', '/api/used');
    assert.equal(ul.stats.count, st0.count + 2); assert.equal(ul.stats.old, st0.old + 1); assert.equal(ul.stats.ek, st0.ek + 18000);
    const u1row = ul.rows.find((r) => r.id === um1.id);
    assert.equal(u1row.hours, 2300); assert.equal(u1row.margin, 9500); assert.ok(u1row.days >= 200); assert.equal(u1row.matches, 1);
    assert.equal((await call('a', 'GET', `/api/searches/${sr1.id}`)).matches[0].id, um1.id);
    // Fotos & Exposé
    const ph = await fetch(base + `/api/used/${um1.id}/photos`, { method: 'POST', headers: { 'X-Requested-With': 'crm', Cookie: jars.a, 'Content-Type': 'image/jpeg' }, body: Buffer.from('jpgdata') }).then((r) => r.json());
    assert.ok(ph.id);
    assert.equal(await call('a', 'GET', `/api/used-photos/${ph.id}`), 'jpgdata');
    const ex = await call('a', 'GET', `/api/used/${um1.id}/expose.html`);
    assert.ok(ex.includes('Weidemann 1390') && ex.includes('27.500 €') && ex.includes(`/api/used-photos/${ph.id}`) && ex.includes('2.300'));
    assert.ok(!(await call('a', 'GET', `/api/used/${um1.id}/expose.html?price=0`)).includes('27.500 €'));
    // öffentliche Maschinenbörse
    let pub = await (await fetch(base + '/boerse/machines.json')).json();
    assert.ok(!pub.machines.some((x) => x.id === um1.id));
    assert.equal((await fetch(base + `/boerse/foto/${ph.id}`)).status, 404);
    await call('a', 'PUT', `/api/used/${um1.id}`, { public: true, show_price: false, notes: 'GEHEIM-NOTIZ' });
    assert.equal((await call('a', 'GET', `/api/used/${um1.id}`)).public, 1);
    await call('a', 'PUT', `/api/used/${um1.id}`, { location: 'Halle 9' }); // andere Änderung lässt Haken stehen
    pub = await (await fetch(base + '/boerse/machines.json')).json();
    const pm = pub.machines.find((x) => x.id === um1.id);
    assert.ok(pm); assert.equal(pm.price_net, null); assert.equal(pm.photos.length, 1);
    assert.match(pm.photos[0], new RegExp(`/boerse/foto/${ph.id}\\.jpg$`)); assert.equal(pm.status, 'verfuegbar'); assert.equal(pm.angebotsnr, `G-${um1.id}`);
    assert.equal((await fetch(pm.photos[0].replace(/^https?:\/\/[^/]+/, base))).status, 200);
    const pubRaw = JSON.stringify(pub);
    assert.ok(!pubRaw.includes('GEHEIM') && !pubRaw.includes('18000') && !pubRaw.includes('purchase') && !pubRaw.includes('Halle 9'));
    await call('a', 'PUT', `/api/used/${um1.id}`, { show_price: true });
    assert.equal((await (await fetch(base + '/boerse/machines.json')).json()).machines.find((x) => x.id === um1.id).price_gross, 32725);
    const fr = await fetch(base + `/boerse/foto/${ph.id}`); assert.equal(fr.status, 200); assert.equal(await fr.text(), 'jpgdata');
    const bp = await fetch(base + '/boerse/'); assert.ok(!bp.headers.get('x-frame-options'));
    assert.ok((await bp.text()).includes('Weidemann 1390'));
    assert.ok((await (await fetch(base + `/boerse/m/${um1.id}?embed=1`)).text()).includes('32.725 €'));
    assert.ok((await (await fetch(base + '/boerse/embed.js')).text()).includes('bussmann-boerse'));
    assert.equal((await fetch(base + `/boerse/m/${um2.id}`)).status, 404);
    // gebrauchter Einkauf -> automatisch im Lager; Verkauf -> verkauft; Verkauf gelöscht -> wieder verfügbar
    const ekU = await call('a', 'POST', '/api/sales', { kind: 'einkauf', date: U.today(), condition: 'gebraucht', category: 'Traktor', brand: 'Fendt', model: '310', purchase_price: '25.000', party: 'Händler X' });
    const autoU = (await call('a', 'GET', '/api/used')).rows.find((r) => r.purchase_id === ekU.id);
    assert.ok(autoU); assert.equal(autoU.purchase_price, 25000);
    assert.equal((await call('a', 'GET', `/api/searches/${srOther.id}`)).matches[0].id, autoU.id);
    const ekNeu = await call('a', 'POST', '/api/sales', { kind: 'einkauf', date: U.today(), condition: 'neu', category: 'Hoftrac', brand: 'Weidemann', model: '1160', purchase_price: '30.000', party: 'Weidemann GmbH' });
    const neuRows = (await call('a', 'GET', '/api/used?condition=neu')).rows;
    assert.ok(neuRows.length >= 1 && neuRows.every((r) => r.condition === 'neu') && neuRows.some((r) => r.purchase_id === ekNeu.id));
    const neuM = await call('a', 'POST', '/api/used', { condition: 'neu', brand: 'Kubota', model: 'L1-382' });
    assert.equal((await call('a', 'GET', `/api/used/${neuM.id}`)).condition, 'neu');
    await call('a', 'DELETE', `/api/used/${neuM.id}`); await call('a', 'DELETE', `/api/sales/${ekNeu.id}`);
    const vkU = await call('a', 'POST', '/api/sales', { kind: 'verkauf', date: U.today(), category: 'Hoftrac', brand: 'Weidemann', model: '1390', sale_price: '27.000', used_id: um1.id, add_machine: false });
    const sold = await call('a', 'GET', `/api/used/${um1.id}`);
    assert.equal(sold.status, 'verkauft'); assert.equal(sold.sale_id, vkU.id);
    assert.equal((await call('a', 'GET', '/api/used')).stats.count, st0.count + 2);
    await call('a', 'DELETE', `/api/sales/${vkU.id}`);
    assert.equal((await call('a', 'GET', `/api/used/${um1.id}`)).status, 'verfuegbar');
    const vkU2 = await call('a', 'POST', '/api/sales', { kind: 'verkauf', date: U.today(), brand: 'Fendt', model: '310', sale_price: '29.000', purchase_id: ekU.id, add_machine: false });
    assert.equal((await call('a', 'GET', `/api/used/${autoU.id}`)).status, 'verkauft'); // über den Einkauf erkannt
    await call('a', 'DELETE', `/api/sales/${vkU2.id}`);
    await assert.rejects(call('k', 'DELETE', `/api/used/${um2.id}`), /403/);
    // Kopplung Suchauftrag <-> Verkaufsprojekt
    const pj1 = await call('a', 'POST', '/api/projects', { customer_id: id, brand: 'Weidemann', typ: 'Hoftrac', status: 'Bedarf geklärt', preis: '30.000' });
    const ps = await call('a', 'POST', `/api/projects/${pj1.id}/search`, {});
    assert.equal(ps.project_id, pj1.id); assert.ok(ps.matches.some((m) => m.id === um1.id));
    await assert.rejects(call('a', 'POST', `/api/projects/${pj1.id}/search`, {}), /offenen Suchauftrag/);
    assert.equal((await call('a', 'GET', `/api/projects/${pj1.id}`)).search.id, ps.id);
    const pj2 = await call('a', 'POST', `/api/searches/${sr1.id}/project`, { used_id: um1.id });
    const pj2d = await call('a', 'GET', `/api/projects/${pj2.id}`);
    assert.equal(pj2d.used.id, um1.id); assert.equal(pj2d.preis, 27500); assert.equal(pj2d.search.id, sr1.id);
    assert.equal((await call('a', 'POST', `/api/searches/${sr1.id}/project`, {})).existing, true);
    await call('a', 'PUT', `/api/projects/${pj2.id}`, { status: 'Gewonnen' });
    const soldU = await call('a', 'GET', `/api/used/${um1.id}`);
    assert.equal(soldU.status, 'verkauft');
    const pSale = await call('a', 'GET', `/api/sales/${soldU.sale_id}`);
    assert.equal(pSale.purchase_price, 18000); assert.equal(pSale.condition, 'gebraucht'); assert.equal(pSale.year, 2018);
    assert.equal((await call('a', 'GET', `/api/searches/${sr1.id}`)).status, 'erledigt');
    await call('a', 'PUT', `/api/projects/${pj2.id}`, { status: 'Verhandlung' });
    assert.equal((await call('a', 'GET', `/api/used/${um1.id}`)).status, 'verfuegbar');
    await call('a', 'PUT', `/api/projects/${pj1.id}`, { status: 'Verloren' });
    assert.equal((await call('a', 'GET', `/api/searches/${ps.id}`)).status, 'erledigt');
    await call('a', 'DELETE', `/api/projects/${pj1.id}`); await call('a', 'DELETE', `/api/projects/${pj2.id}`);
    await call('a', 'DELETE', `/api/searches/${ps.id}`);
    await call('a', 'DELETE', `/api/used/${um1.id}`);
    assert.ok(!fs.existsSync(path.join(dir, 'files', `used${um1.id}_x`)));
    await call('a', 'PUT', `/api/searches/${sr1.id}`, { status: 'erledigt' });
    assert.equal((await call('a', 'GET', '/api/searches')).length, 1);
    await call('a', 'DELETE', `/api/searches/${srOther.id}`);

    // Angebot hochladen und auswerten
    const OT = require('../lib/offer-text');
    const sample = [
      '                                                                         Probeausdruck Angebot',
      'Firma',
      'Muster Agrar GbR                                                           ANGEBOT',
      'Am Feldweg 7',
      '48329 Havixbeck',
      '                                                                           Nummer:            70001',
      '                                                                           Kunden­Nr.:        99999',
      '                                                                           Datum:             02.11.2026',
      'Pos Artikel                                        Menge          E­Preis                 Endpreis M',
      '1 WD1390                 Weidemann 1390            1,00          30.000,00               30.000,00 1',
      '                         mit Komfortkabine',
      '2    40001               Schaufel 1,0m             1,00           1.000,00                1,000,00 1',
      '3    40002               Hydraulikbausatz mit      1,00             500,00',
      '                         Steuergerät                                                      500,00 1',
      '4                        Inzahlungnahme Weidemann 1140 Bj. 2012   1,00   -8.000,00     -8.000,00 1',
      '5                        Überführungkosten         1,00             300,00                  300,00 1',
      '                                                 Netto­Betrag      MwSt­Betrag     Brutto­Betrag',
      '                                 19.00% MwSt. (1)  23.800,00        4.522,00          28.322,00',
      '                                         Summe     23.800,00        4.522,00          28.322,00',
      '                                                       Das Angebot ist gültig bis zum 30.11.26.',
    ].join('\n');
    const ox = OT.parseText(sample);
    assert.equal(ox.firma, 'Muster Agrar GbR'); assert.equal(ox.plz, '48329'); assert.equal(ox.strasse, 'Am Feldweg 7');
    assert.equal(ox.marke, 'Weidemann'); assert.equal(ox.modell, '1390'); assert.equal(ox.maschinentyp, 'Hoftrac');
    assert.equal(ox.angebot_nr, '70001'); assert.equal(ox.angebot_datum, '2026-11-02'); assert.equal(ox.gueltig_bis, '2026-11-30');
    assert.equal(ox.inzahlung_wert, 8000); assert.match(ox.inzahlung, /1140/);
    assert.equal(ox.preis_netto, 31800); // ohne Abzug der Inzahlungnahme
    assert.match(ox.ausstattung, /Hydraulikbausatz mit Steuergerät/); assert.doesNotMatch(ox.ausstattung, /Überführung/);
    assert.equal(OT.parseText('Rechnung ohne alles'), null);
    const upload = async (buf, type, name) => {
      const r = await fetch(base + '/api/projects/parse-offer', { method: 'POST', headers: { 'X-Requested-With': 'crm', Cookie: jars.a, 'Content-Type': type, 'X-Filename': encodeURIComponent(name) }, body: buf });
      const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
    };
    // PDF ohne erkennbaren Text, ohne KI-Schlüssel: nur ablegen
    const u0 = await upload(Buffer.from('%PDF-1.4 kaputt'), 'application/pdf', 'Angebot.pdf');
    assert.ok(u0.file.token.startsWith('offer_')); assert.equal(u0.fields, undefined); assert.equal(u0.error, 'not_recognized');
    await assert.rejects(upload(Buffer.from('x'), 'text/plain', 'a.txt'), /PDF oder Foto/);
    // Foto mit KI (Auswertung im Test simuliert)
    const OFF = require('../lib/offer');
    const realParse = OFF.parseOffer;
    OFF.parseOffer = async () => ({ ...ox, firma: null, vorname: 'Daniel', nachname: 'Dircks', plz: '48727', ort: 'Billerbeck', strasse: 'Aulendorfer Weg 13', finanzierung: 'Leasing', email: null, telefon: null, ansprechpartner: null });
    await call('a', 'PUT', '/api/settings', { ai_key: 'sk-test' });
    assert.equal((await call('a', 'GET', '/api/settings')).ai_key_set, true);
    assert.equal((await call('a', 'GET', '/api/projects?meta=1')).ai, true);
    const u1 = await upload(Buffer.from('fakejpg'), 'image/jpeg', 'foto.jpg');
    assert.equal(u1.source, 'ai'); assert.equal(u1.fields.brand, 'Weidemann'); assert.equal(u1.fields.preis, 31800); assert.equal(u1.fields.finanzierung, 'Leasing');
    assert.equal(u1.matches[0].id, id); // Daniel Dircks aus Billerbeck erkannt
    assert.match(u1.fields.notizen, /Angebot Nr\. 70001/);
    OFF.parseOffer = async () => { throw new OFF.OfferError('Der KI-Schlüssel ist ungültig'); };
    const u2 = await upload(Buffer.from('fakejpg'), 'image/jpeg', 'foto2.jpg');
    assert.match(u2.error, /ungültig/); assert.ok(u2.file.token);
    OFF.parseOffer = realParse;
    await call('a', 'PUT', '/api/settings', { ai_key_clear: true });
    // Speichern hängt das Angebot ans Projekt und legt es beim Kunden ab
    const filesBefore = (await call('a', 'GET', `/api/customers/${id}`)).files.length;
    const { id: po } = await call('a', 'POST', '/api/projects', { customer_id: id, brand: 'Weidemann', modell: '1390', status: 'Angebot erstellt', offer_file: { token: u1.file.token, name: 'Angebot 70001.jpg', mime: 'image/jpeg' } });
    const pod = await call('a', 'GET', `/api/projects/${po}`);
    assert.equal(pod.offer_name, 'Angebot 70001.jpg');
    assert.equal(await call('a', 'GET', `/api/projects/${po}/offer`), 'fakejpg');
    assert.equal((await call('a', 'GET', `/api/customers/${id}`)).files.length, filesBefore + 1);
    await call('a', 'POST', '/api/projects', { kunde: 'X', brand: 'Fendt', offer_file: { token: '../../etc/passwd', name: 'x' } }); // ungültig -> ignoriert
    await call('a', 'DELETE', `/api/projects/${po}`);
    assert.ok(!fs.existsSync(path.join(dir, 'files', u1.file.token)));

    // Abwesenheiten
    const d1 = U.addDays(U.today(), 20); const d3 = U.addDays(U.today(), 22);
    const absId = (await call('k', 'POST', '/api/absences', { kind: 'urlaub', start_date: d1, end_date: d3, note: 'Mallorca' })).id;
    const multi = (await call('k', 'POST', '/api/absences', { kind: 'privat', start_date: d1, start_time: '08:00', end_time: '10:00', end_date: U.addDays(d1, 5) })).id;
    assert.equal((await call('k', 'GET', '/api/absences?user=' + kollege.id)).find((x) => x.id === multi).start_time, null, 'mehrtägig = ganztägig');
    await call('k', 'DELETE', '/api/absences/' + multi);
    let chk = await call('a', 'GET', `/api/absences/check?date=${U.addDays(d1, 1)}&users=${kollege.id},${me.user.id}`);
    assert.equal(chk.length, 1); assert.equal(chk[0].label, 'Urlaub');
    assert.equal((await call('a', 'GET', `/api/absences/check?date=${U.addDays(d3, 1)}&users=${kollege.id}`)).length, 0);
    const calAll = await call('t', 'GET', `/api/calendar?from=${d1}&to=${d3}&scope=all`);
    const seen = calAll.absences.find((x) => x.id === absId);
    assert.ok(seen && seen.note === '', 'Kollegen dürfen die Notiz nicht sehen');
    assert.equal((await call('k', 'GET', `/api/calendar?from=${d1}&to=${d3}`)).absences[0].note, 'Mallorca');
    await assert.rejects(call('t', 'DELETE', `/api/absences/${absId}`), /403/);
    const part = (await call('t', 'POST', '/api/absences', { kind: 'privat', start_date: d1, start_time: '08:00', end_time: '10:00' })).id;
    assert.equal((await call('a', 'GET', `/api/absences/check?date=${d1}&time=09:00&users=${third.id}`)).length, 1);
    assert.equal((await call('a', 'GET', `/api/absences/check?date=${d1}&time=11:00&users=${third.id}`)).length, 0);
    await call('t', 'DELETE', `/api/absences/${part}`);
    const kFeed = await (await fetch(base + new URL((await call('k', 'GET', '/api/me/ical')).https).pathname)).text();
    assert.ok(kFeed.includes('SUMMARY:Urlaub: Mallorca'));

    // Wiederholungen
    {
      const S = require('../lib/series');
      assert.equal(S.addMonths('2027-01-31', 1), '2027-02-28');
      assert.equal(S.nextDate('2027-01-31', 'monthly', '2027-02-28'), '2027-03-31');
      assert.equal(S.nextDate('2027-01-01', 'weekdays', '2027-01-01'), '2027-01-04'); // Fr -> Mo
      const d0 = U.addDays(U.today(), 2);
      const ser = await call('a', 'POST', '/api/tasks', { title: 'Teambesprechung', kind: 'termin', due_date: d0, due_time: '08:00', repeat: 'weekly', repeat_until: U.addDays(d0, 28), participants: [kollege.id] });
      const occ = () => call('a', 'GET', `/api/tasks?scope=all&q=Teambesprechung`);
      let list = await occ();
      assert.equal(list.length, 5); assert.deepEqual(list.map((t) => t.due_date), [0, 7, 14, 21, 28].map((n) => U.addDays(d0, n)));
      assert.ok(list.every((t) => t.series_id && t.repeat === 'weekly' && t.due_time === '08:00'));
      assert.ok((await call('k', 'GET', `/api/tasks/${list[3].id}`)).participant_ids.includes(String(kollege.id)));
      // nur dieser
      await call('a', 'PUT', `/api/tasks/${list[1].id}`, { title: 'Teambesprechung (verschoben)', due_time: '10:00', scope: 'one' });
      list = await occ(); assert.equal(list.length, 5); assert.equal(list.filter((t) => t.due_time === '10:00').length, 1);
      // dieser und folgende: andere Uhrzeit
      await call('a', 'PUT', `/api/tasks/${list[2].id}`, { due_time: '09:00', scope: 'following', repeat: 'weekly', repeat_until: U.addDays(d0, 28) });
      list = await occ(); assert.equal(list.length, 5);
      assert.deepEqual(list.map((t) => t.due_time), ['08:00', '10:00', '09:00', '09:00', '09:00']);
      // ab dem 4. löschen
      await call('a', 'DELETE', `/api/tasks/${list[3].id}?scope=following`);
      list = await occ(); assert.equal(list.length, 3);
      // ohne Ende: wird bis zum Horizont angelegt und nicht doppelt nachgelegt
      const y = await call('a', 'POST', '/api/tasks', { title: 'Winterdienst-Aktion', kind: 'aufgabe', due_date: U.addDays(U.today(), 1), repeat: 'yearly' });
      const yl = (await call('a', 'GET', '/api/tasks?scope=all&q=Winterdienst-Aktion')).length;
      assert.ok(yl >= 2 && yl <= 3);
      assert.equal(S.extendAll(), 0);
      await call('a', 'DELETE', `/api/tasks/${y.id}?scope=following`);
      assert.equal((await call('a', 'GET', '/api/tasks?scope=all&q=Winterdienst-Aktion')).length, 0);
      for (const t of await occ()) await call('a', 'DELETE', `/api/tasks/${t.id}`);
      assert.ok(ser.id);
    }

    // iCal
    const ical = await call('a', 'GET', '/api/me/ical');
    const feed = await (await fetch(base + new URL(ical.https).pathname)).text();
    assert.ok(feed.startsWith('BEGIN:VCALENDAR'));
    assert.ok(feed.includes('BEGIN:VALARM'));
    assert.ok(feed.includes('Geburtstag Daniel Dircks'));
    assert.ok(!feed.split('\r\n').some((l) => Buffer.byteLength(l) > 75), 'Zeilen nicht gefaltet');

    // Rechte
    await assert.rejects(call('k', 'DELETE', `/api/customers/${id}`), /403/);
    await assert.rejects(call('x', 'GET', '/api/customers'), /401/);

    console.log('✓ Alle Tests bestanden');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('✗', e); process.exit(1); });
