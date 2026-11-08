/* ==========================================================================
   JobConnect — modules annexes du Worker
   Réglages, e-mails (Resend), Stripe, reçus PDF, SLA.
   Aucune simulation : si une clé manque, l'API le dit explicitement.
   ========================================================================== */

/* ------------------------------------------------------------- réglages */

const DEFAULT_SETTINGS = {
  jobconnect_fee_cents: 4900,
  sla_target_min_minutes: 5,
  sla_target_max_minutes: 20,
  default_recruiter_price_cents: 15000,
  recruiter_price_cents: 9500,
  promo_price_cents: 4900,
  currency: 'USD'
};

async function loadSettings(env, rest) {
  const rows = await rest(env, 'settings?select=key,value');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows || []) {
    const n = Number(row.value);
    out[row.key] = Number.isFinite(n) && /cents|minutes/.test(row.key) ? n : row.value;
  }
  return out;
}

/* ------------------------------------------------------------------ e-mail
   Envoi réel via Resend. Sans RESEND_API_KEY, l'envoi est journalisé comme
   "skipped" et la réponse le signale : on ne prétend jamais avoir envoyé. */

const mailConfigured = (env) => Boolean(env.RESEND_API_KEY && env.MAIL_FROM);

async function sendEmail(env, rest, { to, subject, html, text, template, userId = null }) {
  const row = {
    user_id: userId,
    to_email: to,
    template,
    subject,
    provider: 'resend',
    status: 'queued'
  };

  if (!mailConfigured(env)) {
    await rest(env, 'email_log', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { ...row, status: 'skipped', error: 'RESEND_API_KEY / MAIL_FROM not configured' }
    });
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        html,
        text: text || undefined
      })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await rest(env, 'email_log', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { ...row, status: 'failed', error: String(data.message || res.status).slice(0, 400) }
      });
      return { sent: false, reason: 'provider_error', detail: data.message || res.status };
    }

    await rest(env, 'email_log', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { ...row, status: 'sent', provider_message_id: data.id || null }
    });
    return { sent: true, id: data.id };
  } catch (err) {
    await rest(env, 'email_log', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { ...row, status: 'failed', error: String(err.message || err).slice(0, 400) }
    });
    return { sent: false, reason: 'network_error' };
  }
}

function money(cents, currency = 'USD') {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function emailLayout(title, bodyHtml, footer = '') {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f7ff;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0b1b49">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3eaf8">
    <tr><td style="background:#0b1b49;padding:20px 26px;color:#fff;font-size:18px;font-weight:800">JobConnect</td></tr>
    <tr><td style="padding:26px">
      <h1 style="margin:0 0 14px;font-size:20px">${title}</h1>
      ${bodyHtml}
      ${footer ? `<p style="margin-top:24px;font-size:11px;color:#64718b">${footer}</p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 26px;background:#f4f7ff;font-size:11px;color:#64718b">
      JobConnect · international work contracts · contact@jobconnect.example
    </td></tr>
  </table></td></tr></table></body></html>`;
}

/* ------------------------------------------------------------------ Stripe
   Checkout Sessions + vérification de signature de webhook. */

let CRED_CACHE = { at: 0, secret: null, publishable: null, webhook: null, source: 'none' };

/**
 * Clés Stripe effectives.
 * L'admin peut changer le compte encaisseur depuis l'application : la clé est
 * alors stockée chiffrée en base (pgp_sym_encrypt) et prend le pas sur la
 * variable d'environnement. Le cache évite un aller-retour SQL par requête.
 */
async function loadStripeCredentials(env, rest, { force = false } = {}) {
  const now = Date.now();
  if (!force && CRED_CACHE.at && now - CRED_CACHE.at < 60000) return CRED_CACHE;

  let secret = env.STRIPE_SECRET_KEY || null;
  let publishable = env.STRIPE_PUBLISHABLE_KEY || null;
  let source = secret ? 'environment' : 'none';

  let webhook = env.STRIPE_WEBHOOK_SECRET || null;

  if (env.CREDENTIAL_KEY && rest) {
    try {
      const read = (key) =>
        rest(env, 'rpc/jc_get_credential', {
          method: 'POST',
          body: { p_key: key, p_passphrase: env.CREDENTIAL_KEY }
        });
      const [dbSecret, dbPub, dbWebhook] = await Promise.all([
        read('stripe_secret_key'),
        read('stripe_publishable_key'),
        read('stripe_webhook_secret')
      ]);
      if (typeof dbWebhook === 'string' && dbWebhook.startsWith('whsec_')) webhook = dbWebhook;
      if (typeof dbSecret === 'string' && dbSecret.startsWith('sk_')) {
        secret = dbSecret;
        source = 'admin_console';
      }
      if (typeof dbPub === 'string' && dbPub.startsWith('pk_')) {
        publishable = dbPub;
      }
    } catch (err) {
      console.error('credential read failed:', err && err.message ? err.message : err);
    }
  }

  CRED_CACHE = { at: now, secret, publishable, webhook, source };
  return CRED_CACHE;
}

function resetStripeCredentials() {
  CRED_CACHE = { at: 0, secret: null, publishable: null, webhook: null, source: 'none' };
}

async function stripeCreds(env, rest) {
  const c = await loadStripeCredentials(env, rest, { force: true });
  return c.secret || '';
}

const stripeConfigured = (env) => Boolean(env.STRIPE_SECRET_KEY);

async function stripeRequest(env, path, params, rest) {
  const secret = rest ? await stripeCreds(env, rest) : env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe is not configured.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
  }
  return data;
}

async function stripeCancel(env, path, rest) {
  const secret = rest ? await stripeCreds(env, rest) : env.STRIPE_SECRET_KEY || '';
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
  return data;
}

/** Vérifie l'en-tête Stripe-Signature sur le corps brut. */
async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.t = v;
    if (k === 'v1') acc.v1 = acc.v1 || v;
    return acc;
  }, {});

  if (!parts.t || !parts.v1) return false;

  // Tolérance de 5 minutes contre le rejeu.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parts.t}.${rawBody}`)
  );
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Comparaison à temps constant.
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------------------------------------------------- reçu PDF
   Générateur PDF minimal (une page, texte). Aucune dépendance. */

function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildReceiptPdf({ receiptNumber, date, payerName, payerEmail, lines, total, currency }) {
  const rows = [
    ['JobConnect', 'Official payment receipt'],
    ['Receipt', receiptNumber],
    ['Date', date],
    ['Customer', payerName || '-'],
    ['Email', payerEmail || '-'],
    ['', ''],
    ...lines.map((l) => [l.label, money(l.amount_cents, currency)]),
    ['', ''],
    ['TOTAL PAID', money(total, currency)]
  ];

  let y = 780;
  const content = [];
  content.push('BT /F1 20 Tf 56 800 Td (JobConnect) Tj ET');
  content.push('BT /F1 10 Tf 56 784 Td (International work contracts - payment receipt) Tj ET');
  content.push('0.8 w 56 774 m 540 774 l S');

  for (const [label, value] of rows) {
    if (label) {
      content.push(`BT /F1 11 Tf 56 ${y} Td (${pdfEscape(label)}) Tj ET`);
    }
    if (value) {
      content.push(`BT /F1 11 Tf 330 ${y} Td (${pdfEscape(value)}) Tj ET`);
    }
    y -= 24;
  }

  content.push(`BT /F1 8 Tf 56 80 Td (This receipt confirms a payment processed by Stripe. No card details are stored by JobConnect.) Tj ET`);

  const stream = content.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}

/* -------------------------------------------------------------------- SLA */

function slaState(application, settings) {
  const maxMinutes = Number(settings.sla_target_max_minutes || 20);
  const created = new Date(application.created_at).getTime();
  const due = application.response_due_at
    ? new Date(application.response_due_at).getTime()
    : created + maxMinutes * 60000;
  const decided = application.first_response_at
    ? new Date(application.first_response_at).getTime()
    : null;

  const now = Date.now();
  const reference = decided || now;
  const elapsedMinutes = Math.max(0, Math.round((reference - created) / 60000));
  const remainingMinutes = Math.round((due - reference) / 60000);

  return {
    target_min_minutes: Number(settings.sla_target_min_minutes || 5),
    target_max_minutes: maxMinutes,
    elapsed_minutes: elapsedMinutes,
    remaining_minutes: remainingMinutes,
    overdue: !decided && now > due,
    within_target: decided ? elapsedMinutes <= maxMinutes : null,
    due_at: new Date(due).toISOString()
  };
}

export {
  DEFAULT_SETTINGS,
  loadSettings,
  sendEmail,
  emailLayout,
  money,
  mailConfigured,
  stripeConfigured,
  loadStripeCredentials,
  resetStripeCredentials,
  stripeCreds,
  stripeRequest,
  stripeCancel,
  verifyStripeSignature,
  buildReceiptPdf,
  slaState
};
