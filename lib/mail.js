'use strict';
const nodemailer = require('nodemailer');
const { getSetting } = require('./db');

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || getSetting('smtp_host'),
    port: Number(process.env.SMTP_PORT || getSetting('smtp_port') || 587),
    secure: (process.env.SMTP_SECURE || getSetting('smtp_secure')) === '1',
    user: process.env.SMTP_USER || getSetting('smtp_user'),
    pass: process.env.SMTP_PASS || getSetting('smtp_pass'),
    from: process.env.SMTP_FROM || getSetting('smtp_from'),
  };
}
function mailEnabled() { const c = smtpConfig(); return !!(c.host && c.from); }
function appUrl() { return (process.env.APP_URL || getSetting('app_url') || '').replace(/\/+$/, ''); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml, link) {
  const url = appUrl();
  const button = link && url ? `<p style="margin:24px 0"><a href="${esc(url + link)}" style="background:#c0292f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Im CRM öffnen</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#2b2d2e">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#fff;border-top:4px solid #c0292f;border-radius:6px;padding:24px">
<div style="font-weight:800;font-size:18px;color:#c0292f;letter-spacing:.5px">BUSSMANN</div>
<div style="font-size:11px;color:#6a6d6e;margin-bottom:16px">LAND- &amp; GARTENTECHNIK · CRM</div>
<h2 style="font-size:18px;margin:0 0 12px">${esc(title)}</h2>
${bodyHtml}${button}
</div>
<p style="font-size:11px;color:#6a6d6e;text-align:center">Diese Nachricht wurde automatisch vom Bussmann CRM versendet.</p>
</div></body></html>`;
}

async function sendMail({ to, subject, title, html, text, link }) {
  if (!mailEnabled() || !to) return { skipped: true };
  const c = smtpConfig();
  const transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  });
  return transport.sendMail({ from: c.from, to, subject, text, html: layout(title || subject, html, link) });
}

module.exports = { sendMail, mailEnabled, smtpConfig, appUrl, esc };
