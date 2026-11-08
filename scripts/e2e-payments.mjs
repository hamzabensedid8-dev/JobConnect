/**
 * Test d'intégration du webhook Stripe (signature réelle) + génération du reçu.
 * Vérifie que le chemin de paiement fonctionne sans jamais simuler un succès.
 */

const BASE = process.env.BASE || 'https://jc.jobconnectdz.workers.dev';
const PROJECT = 'nwezezjssrigrjqfoqov';
const PAT = process.env.SUPABASE_PAT;   // management token, never committed
if (!PAT) { console.error('SUPABASE_PAT is required for this suite.'); process.exit(1); }
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ADMIN_KEY = process.env.ADMIN_CLIENT_KEY;
const ADMIN_PW = process.env.ADMIN_PASSWORD;

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} :: ${detail}`); console.log(`  FAIL  ${name}  ${detail}`); }
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function sign(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

const csrf = await api('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@jobconnect.example', password: ADMIN_PW },
  token: undefined
}).catch(() => null);

// Connexion admin (avec clé client)
const loginRes = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-jc-client-key': ADMIN_KEY },
  body: JSON.stringify({ email: 'admin@jobconnect.example', password: ADMIN_PW })
});
const admin = await loginRes.json();
const adminT = admin.token;

console.log('\n=== PRÉPARATION ===');
const stamp = Date.now();
const candEmail = `wh.${stamp}@example.com`;

const fd = new FormData();
fd.set('name', 'Webhook Candidate');
fd.set('email', candEmail);
fd.set('password', 'SuperSecret12345');
fd.set('role', 'candidate');
fd.set('cv', new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' }));
const regRes = await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd });
const cand = await regRes.json();
check('candidat créé', regRes.status === 201, regRes.status);
const candT = cand.token;

const jobRes = await api('/api/jobs', {
  method: 'POST', token: adminT,
  body: {
    title: 'Ward Nurse', company: 'Test Clinic', description: 'Ward nursing role.',
    country: 'Norway', contract_type: 'Permanent', recruiter_price_cents: 20000
  }
});
const jobId = jobRes.data.id;
check('offre publiée par l’admin', jobRes.status === 201, jobRes.status);

const applyFd = new FormData();
applyFd.set('cv', new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' }));
const applyRes = await fetch(BASE + `/api/jobs/${jobId}/apply`, {
  method: 'POST', headers: { Authorization: `Bearer ${candT}` }, body: applyFd
});
const applied = await applyRes.json();
const appRef = applied.reference;
check('candidature créée', applyRes.status === 201, applyRes.status);

// Ligne de paiement telle que créée par /api/payments/checkout avant Stripe.
const payRef = `JC-PAY-TEST${String(stamp).slice(-6)}`;
const sessionId = `cs_test_${stamp}`;
await sql(`insert into public.payments (reference, application_id, payer_id, kind, fee_cents, recruiter_price_cents, total_cents, currency, status, provider_session_id)
  select '${payRef}', a.id, a.candidate_id, 'application', a.fee_cents, a.recruiter_price_cents, a.total_cents, a.currency, 'pending', '${sessionId}'
  from public.applications a where a.reference = '${appRef}'`);
const payRows = await sql(`select id, status, total_cents from public.payments where reference = '${payRef}'`);
check('paiement en attente enregistré', Array.isArray(payRows) && payRows.length === 1, JSON.stringify(payRows).slice(0, 120));

console.log('\n=== SIGNATURE DU WEBHOOK ===');
const event = JSON.stringify({
  id: 'evt_test_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: sessionId,
      object: 'checkout.session',
      payment_intent: 'pi_test_123',
      metadata: { application_reference: appRef, payment_reference: payRef }
    }
  }
});

const badRes = await fetch(BASE + '/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + Math.floor(Date.now() / 1000) + ',v1=' + 'a'.repeat(64) },
  body: event
});
check('signature invalide rejetée (400)', badRes.status === 400, badRes.status);

const oldTs = Math.floor(Date.now() / 1000) - 3600;
const expiredRes = await fetch(BASE + '/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': await sign(event, WEBHOOK_SECRET, oldTs) },
  body: event
});
check('signature expirée rejetée (anti-rejeu)', expiredRes.status === 400, expiredRes.status);

const tampered = event.replace('pi_test_123', 'pi_tampered');
const tamperedRes = await fetch(BASE + '/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': await sign(event, WEBHOOK_SECRET) },
  body: tampered
});
check('corps modifié rejeté', tamperedRes.status === 400, tamperedRes.status);

const okRes = await fetch(BASE + '/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': await sign(event, WEBHOOK_SECRET) },
  body: event
});
check('événement signé accepté (200)', okRes.status === 200, okRes.status);

console.log('\n=== EFFETS DU PAIEMENT ===');
const after = await sql(`select p.status, p.receipt_number, p.paid_at, a.paid_at as app_paid from public.payments p join public.applications a on a.id = p.application_id where p.reference = '${payRef}'`);
const row = (after || [])[0] || {};
check('paiement passé à paid', row.status === 'paid', row.status);
check('numéro de reçu attribué', /^JC-R-\d{4}-[A-Z0-9]+$/.test(row.receipt_number || ''), row.receipt_number);
check('candidature marquée payée', !!row.app_paid, String(row.app_paid));

const emails = await sql(`select template, status from public.email_log where to_email = '${candEmail}' order by id desc limit 5`);
check('reçu envoyé par e-mail (journalisé)', Array.isArray(emails) && emails.length > 0, JSON.stringify(emails).slice(0, 140));

const notif = await api('/api/notifications', { token: candT });
check('notification de paiement créée', (notif.data.notifications || []).some((n) => n.type === 'payment_confirmed'), JSON.stringify(notif.data).slice(0, 140));

const idempotent = await fetch(BASE + '/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': await sign(event, WEBHOOK_SECRET) },
  body: event
});
const idemBody = await idempotent.json();
check('rejeu idempotent (pas de double débit)', idemBody.idempotent === true, JSON.stringify(idemBody).slice(0, 120));

console.log('\n=== REÇU PDF ===');
const receipt = await fetch(BASE + `/api/payments/${payRef}/receipt.pdf`, { headers: { Authorization: `Bearer ${candT}` } });
const buf = new Uint8Array(await receipt.arrayBuffer());
check('reçu téléchargeable', receipt.status === 200, receipt.status);
check('content-type application/pdf', (receipt.headers.get('content-type') || '').includes('pdf'), receipt.headers.get('content-type'));
check('en-tête PDF valide', String.fromCharCode(...buf.slice(0, 5)) === '%PDF-', String.fromCharCode(...buf.slice(0, 8)));
check('reçu non vide', buf.length > 800, buf.length + ' octets');

const otherUser = await fetch(BASE + `/api/payments/${payRef}/receipt.pdf`, { headers: { Authorization: `Bearer ${adminT}` } });
check('admin peut lire le reçu', otherUser.status === 200, otherUser.status);
const anon = await fetch(BASE + `/api/payments/${payRef}/receipt.pdf`);
check('reçu protégé sans session', anon.status === 401, anon.status);

console.log('\n=== DÉCISION APRÈS PAIEMENT ===');
const dec = await api(`/api/admin/applications/${appRef}`, {
  method: 'PATCH', token: adminT,
  body: { status: 'accepted', decision_reason: 'Documents verified, contract issued.' }
});
check('admin accepte après paiement', dec.status === 200, dec.status);
check('réponse dans le délai cible', dec.data.sla && dec.data.sla.within_target === true, JSON.stringify(dec.data.sla));

const track = await api(`/api/applications/track/${appRef}`);
check('suivi public reflète accepted', track.data.application.status === 'accepted', track.data.application.status);
check('suivi expose le motif', /contract issued/i.test(track.data.application.decision_reason || ''), track.data.application.decision_reason);

console.log('\n=== COMPTE ENCAISSEUR (CONSOLE ADMIN) ===');
const anonAcct = await api('/api/admin/payments/account');
check('compte encaisseur protégé sans session', anonAcct.status === 401, anonAcct.status);

const acct0 = await api('/api/admin/payments/account', { token: adminT });
check('admin lit son compte encaisseur', acct0.status === 200, acct0.status);
check('clé jamais renvoyée en clair', !/sk_(live|test)_[A-Za-z0-9]{8,}/.test(JSON.stringify(acct0.data)), JSON.stringify(acct0.data).slice(0, 160));
check('source du compte exposée', ['none', 'environment', 'admin_console'].includes(acct0.data.source), acct0.data.source);

const badSecret = await api('/api/admin/payments/account', {
  method: 'PUT', token: adminT, body: { secret_key: 'sk_test_not_a_real_key' }
});
check('clé Stripe invalide refusée (400)', badSecret.status === 400, badSecret.status + ' ' + JSON.stringify(badSecret.data).slice(0, 120));

const badHook = await api('/api/admin/payments/account', {
  method: 'PUT', token: adminT, body: { webhook_secret: 'pas-un-whsec' }
});
check('secret webhook mal formé refusé (400)', badHook.status === 400, badHook.status);

const okHook = await api('/api/admin/payments/account', {
  method: 'PUT', token: adminT, body: { webhook_secret: 'whsec_e2e0123456789abcdef', label: 'e2e' }
});
check('secret webhook valide accepté', okHook.status === 200, okHook.status + ' ' + JSON.stringify(okHook.data).slice(0, 120));

const acct1 = await api('/api/admin/payments/account', { token: adminT });
check('webhook enregistré et masqué', acct1.data.webhook_configured === true && /^whsec_…/.test(acct1.data.webhook_secret || ''), JSON.stringify(acct1.data).slice(0, 160));

const cleared = await api('/api/admin/payments/account', { method: 'DELETE', token: adminT });
check('compte encaisseur supprimable', cleared.status === 200, cleared.status);

console.log('\n=== FORMULAIRE CARTE (PAYMENTINTENT) ===');
const intentAnon = await api('/api/payments/intent', { method: 'POST', body: { reference: appRef } });
check('intent protégé sans session', intentAnon.status === 401, intentAnon.status);
const intentUnknown = await api('/api/payments/intent', { method: 'POST', token: adminT, body: { reference: 'JC-ZZZZZZ' } });
check('intent sur référence inconnue -> 404', intentUnknown.status === 404, intentUnknown.status);

console.log(`\n${'='.repeat(56)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
