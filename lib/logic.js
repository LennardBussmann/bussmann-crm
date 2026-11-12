'use strict';
const { get, all, run } = require('./db');
const U = require('./util');
const { sendMail, esc } = require('./mail');

function customerName(c) {
  if (!c) return '';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') + (c.company ? ` (${c.company})` : '');
}

function systemEntry(customerId, userId, text) {
  run(`INSERT INTO entries(customer_id, kind, happened_at, text, created_by) VALUES(?,?,?,?,?)`,
    customerId, 'system', U.nowLocal(), text, userId ?? null);
}

function notify(userId, text, taskId, customerId, link) {
  run('INSERT INTO notifications(user_id, task_id, customer_id, text, link) VALUES(?,?,?,?,?)', userId, taskId ?? null, customerId ?? null, text, link ?? null);
}

function fmtDue(t) {
  const [y, m, d] = t.due_date.split('-');
  return `${d}.${m}.${y}${t.due_time ? ', ' + t.due_time + ' Uhr' : ''}`;
}

function taskMailHtml(t, intro) {
  const c = t.customer_id ? get('SELECT * FROM customers WHERE id=?', t.customer_id) : null;
  const rows = [
    ['Art', U.TASK_KINDS[t.kind] || t.kind],
    ['Fällig', fmtDue(t)],
    c ? ['Kunde', customerName(c)] : null,
    c && (c.mobile || c.phone) ? ['Telefon', [c.mobile, c.phone].filter(Boolean).join(' / ')] : null,
    c && c.city ? ['Ort', [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')] : null,
    t.location ? ['Treffpunkt', t.location] : null,
  ].filter(Boolean);
  return `<p>${intro}</p>
<p style="font-size:16px;font-weight:700;margin:8px 0">${esc(t.title)}</p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#6a6d6e">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join('')}</table>
${t.description ? `<p style="white-space:pre-wrap;background:#f6f6f6;padding:10px;border-radius:4px">${esc(t.description)}</p>` : ''}`;
}

/** Benachrichtigt den zugewiesenen Kollegen, wenn ihm jemand anderes eine Aufgabe zuweist. */
async function notifyAssignment(taskId, actorId) {
  const t = get('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t || !t.assigned_to || t.assigned_to === actorId) return;
  const actor = get('SELECT name FROM users WHERE id=?', actorId);
  const assignee = get('SELECT * FROM users WHERE id=?', t.assigned_to);
  if (!assignee || !assignee.active) return;
  notify(assignee.id, `${actor ? actor.name : 'Jemand'} hat Ihnen eine Aufgabe zugewiesen: ${t.title}`, t.id, t.customer_id);
  if (assignee.notify_email) {
    try {
      await sendMail({
        to: assignee.email,
        subject: `Neue Aufgabe: ${t.title}`,
        title: 'Ihnen wurde eine Aufgabe zugewiesen',
        html: taskMailHtml(t, `<b>${esc(actor ? actor.name : 'Ein Kollege')}</b> hat Ihnen im Bussmann CRM eine Aufgabe zugewiesen.`),
        text: `${actor ? actor.name : 'Ein Kollege'} hat Ihnen eine Aufgabe zugewiesen: ${t.title} (fällig ${fmtDue(t)})`,
        link: `/#/aufgaben/${t.id}`,
      });
    } catch (e) { console.error('[mail] Zuweisung fehlgeschlagen:', e.message); }
  }
}

/** Lädt weitere Mitarbeiter zu einer Aufgabe / einem Termin ein (Hinweis + E-Mail). */
async function notifyParticipants(taskId, actorId, userIds) {
  const t = get('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t || !userIds || !userIds.length) return;
  const actor = get('SELECT name FROM users WHERE id=?', actorId);
  const lead = t.assigned_to ? get('SELECT name FROM users WHERE id=?', t.assigned_to) : null;
  const kind = U.TASK_KINDS[t.kind] || 'Aufgabe';
  for (const uid of userIds) {
    if (uid === actorId) continue;
    const u = get('SELECT * FROM users WHERE id=? AND active=1', uid);
    if (!u) continue;
    notify(u.id, `${actor ? actor.name : 'Jemand'} hat Sie eingeladen (${kind}): ${t.title}`, t.id, t.customer_id);
    if (u.notify_email) {
      try {
        await sendMail({
          to: u.email,
          subject: `Einladung: ${t.title} (${fmtDue(t)})`,
          title: `Sie nehmen teil – ${kind}`,
          html: taskMailHtml(t, `<b>${esc(actor ? actor.name : 'Ein Kollege')}</b> hat Sie im Bussmann CRM als Teilnehmer eingetragen${lead ? ` (zuständig: ${esc(lead.name)})` : ''}. Der Termin erscheint auch in Ihrem Kalender-Abo.`),
          text: `${actor ? actor.name : 'Ein Kollege'} hat Sie eingeladen: ${t.title} (${fmtDue(t)})`,
          link: `/#/aufgaben/${t.id}`,
        });
      } catch (e) { console.error('[mail] Einladung fehlgeschlagen:', e.message); }
    }
  }
}

/**
 * Hält für einen Kunden mit Besuchsintervall genau eine offene, automatische Besuchsaufgabe vor.
 * Fälligkeit = letzter Besuch (Zeitleisten-Eintrag "Besuch" oder erledigte Besuchsaufgabe) + Intervall.
 */
function syncVisitTask(customerId) {
  const c = get('SELECT * FROM customers WHERE id=?', customerId);
  if (!c) return;
  const months = U.INTERVAL_MONTHS[c.visit_interval];
  const open = get(`SELECT * FROM tasks WHERE customer_id=? AND auto_visit=1 AND status='open'`, customerId);
  if (!months) {
    if (open) run('DELETE FROM tasks WHERE id=?', open.id);
    return;
  }
  const lastEntry = get(`SELECT MAX(substr(happened_at,1,10)) d FROM entries WHERE customer_id=? AND kind='besuch'`, customerId).d;
  const lastTask = get(`SELECT MAX(substr(done_at,1,10)) d FROM tasks WHERE customer_id=? AND kind='besuch' AND status='done'`, customerId).d;
  const base = [lastEntry, lastTask].filter(Boolean).sort().pop() || c.created_at.slice(0, 10);
  let due = U.addMonths(base, months);
  const title = `Besuch fällig: ${customerName(c)}`;
  const description = `Regelmäßiger Besuch (${U.INTERVAL_LABEL[c.visit_interval]}). Letzter Besuch: ${lastEntry || lastTask ? base.split('-').reverse().join('.') : 'noch keiner erfasst'}.`;
  const assignee = c.owner_id || c.created_by;
  if (open) {
    if (open.due_date !== due || open.title !== title || open.description !== description) {
      run(`UPDATE tasks SET due_date=?, title=?, description=?, reminder_sent=CASE WHEN due_date=? THEN reminder_sent ELSE 0 END, updated_at=datetime('now','localtime') WHERE id=?`,
        due, title, description, due, open.id);
    }
  } else if (!get(`SELECT id FROM tasks WHERE customer_id=? AND kind='besuch' AND status='open' LIMIT 1`, customerId)) {
    // Nur anlegen, wenn nicht schon ein (manuell geplanter) Besuch offen ist
    run(`INSERT INTO tasks(customer_id, kind, title, description, due_date, assigned_to, created_by, auto_visit, remind_day_before)
         VALUES(?,?,?,?,?,?,?,1,1)`, customerId, 'besuch', title, description, due, assignee ?? null, null);
  }
}

const machineName = (m) => [m.brand, m.model].filter(Boolean).join(' ') || m.category || 'Maschine';

/** Hält für eine Maschine mit "nächste Wartung" genau eine offene Wartungsaufgabe vor. */
function syncMachineTask(machineId) {
  const m = get('SELECT * FROM machines WHERE id=?', machineId);
  if (!m) return;
  const open = get(`SELECT * FROM tasks WHERE machine_id=? AND status='open'`, machineId);
  if (!m.next_service) { if (open) run('DELETE FROM tasks WHERE id=?', open.id); return; }
  const c = get('SELECT * FROM customers WHERE id=?', m.customer_id);
  const title = `Wartung: ${machineName(m)} – ${customerName(c)}`;
  const description = [m.category, m.serial ? `Seriennr. ${m.serial}` : '', m.year ? `Baujahr ${m.year}` : '', m.service_interval ? `Intervall: ${U.INTERVAL_LABEL[m.service_interval]}` : ''].filter(Boolean).join(' · ');
  if (open) {
    if (open.due_date !== m.next_service || open.title !== title || open.description !== description) {
      run(`UPDATE tasks SET due_date=?, title=?, description=?, reminder_sent=CASE WHEN due_date=? THEN reminder_sent ELSE 0 END, updated_at=datetime('now','localtime') WHERE id=?`,
        m.next_service, title, description, m.next_service, open.id);
    }
  } else {
    run(`INSERT INTO tasks(customer_id, machine_id, kind, title, description, due_date, assigned_to, created_by, remind_day_before)
         VALUES(?,?,?,?,?,?,?,?,1)`, m.customer_id, m.id, 'wartung', title, description, m.next_service, c.owner_id || c.created_by || null, null);
  }
}
/** Wartung erledigt -> letzte Wartung = heute, nächste = heute + Intervall */
function machineServiced(machineId, date) {
  const m = get('SELECT * FROM machines WHERE id=?', machineId);
  if (!m) return;
  const months = U.INTERVAL_MONTHS[m.service_interval];
  run(`UPDATE machines SET last_service=?, next_service=?, updated_at=datetime('now','localtime') WHERE id=?`, date, months ? U.addMonths(date, months) : null, m.id);
  syncMachineTask(m.id);
}

function syncAllVisitTasks() {
  for (const { id } of all(`SELECT id FROM customers WHERE visit_interval <> '' OR id IN (SELECT customer_id FROM tasks WHERE auto_visit=1 AND status='open')`)) {
    syncVisitTask(id);
  }
}

/** Erinnerung einen Tag vorher: In-App-Hinweis + E-Mail (falls SMTP eingerichtet). */
async function runReminders() {
  const tomorrow = U.addDays(U.today(), 1);
  const due = all(`SELECT * FROM tasks WHERE status='open' AND remind_day_before=1 AND reminder_sent=0 AND due_date<=? AND due_date>=? AND assigned_to IS NOT NULL`, tomorrow, U.today());
  for (const t of due) {
    run('UPDATE tasks SET reminder_sent=1 WHERE id=?', t.id);
    const ids = [t.assigned_to, ...all('SELECT user_id FROM task_participants WHERE task_id=?', t.id).map((r) => r.user_id)];
    for (const uid of [...new Set(ids)]) await remindUser(t, uid);
  }
}
async function remindUser(t, uid) {
  {
    const u = get('SELECT * FROM users WHERE id=? AND active=1', uid);
    if (!u) return;
    const when = t.due_date === U.today() ? 'heute' : 'morgen';
    notify(u.id, `Erinnerung: „${t.title}“ ist ${when} fällig`, t.id, t.customer_id);
    if (u.notify_email) {
      try {
        await sendMail({
          to: u.email,
          subject: `Erinnerung: ${t.title} (${when})`,
          title: `Erinnerung – ${when} fällig`,
          html: taskMailHtml(t, `Diese Aufgabe ist <b>${when}</b> fällig:`),
          text: `Erinnerung: ${t.title} ist ${when} fällig (${fmtDue(t)}).`,
          link: `/#/aufgaben/${t.id}`,
        });
      } catch (e) { console.error('[mail] Erinnerung fehlgeschlagen:', e.message); }
    }
  }
}

function startScheduler() {
  const tick = async () => {
    try { syncAllVisitTasks(); await runReminders(); }
    catch (e) { console.error('[scheduler]', e); }
  };
  setTimeout(tick, 3000);
  setInterval(tick, 10 * 60 * 1000);
}

module.exports = { machineName, syncMachineTask, machineServiced, customerName, systemEntry, notify, notifyAssignment, notifyParticipants, syncVisitTask, syncAllVisitTasks, runReminders, startScheduler, fmtDue };
