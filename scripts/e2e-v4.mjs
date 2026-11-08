/**
 * JobConnect — suite de tests v4 (cahier des charges complet)
 * BASE=https://... ADMIN_PASSWORD=... ADMIN_CLIENT_KEY=... node scripts/e2e-v4.mjs
 */
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://jc.jobconnectdz.workers.dev';
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || fs.readFileSync('/tmp/jc/admin_pw.txt', 'utf8')).trim();
const ADMIN_CLIENT_KEY = (process.env.ADMIN_CLIENT_KEY || fs.readFileSync('/tmp/jc/adminkey.txt', 'utf8')).trim();

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} :: ${detail}`); console.log(`  FAIL  ${name}  ${detail}`); }
}

async function call(path, { method = 'GET', token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers };
}

const pdf = () => new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' });
const stamp = Date.now();
function reg(fields, withCv) {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.set(k, v));
  if (withCv) f.set('cv', pdf());
  return call('/api/auth/register', { method: 'POST', form: f });
}

const SUPABASE_PAT = process.env.SUPABASE_PAT;   // management token, never committed
const PROJECT = 'nwezezjssrigrjqfoqov';

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function grantSubscription(userId) {
  const rows = await sql(
    `insert into public.subscriptions (user_id, plan, amount_cents, currency, status, current_period_end)
     values ('${userId}', 'recruiter_pro', 9500, 'USD', 'active', now() + interval '30 days')
     on conflict do nothing returning id`);
  return Array.isArray(rows) && rows.length > 0;
}

async function markPaid(reference) {
  await sql(`update public.applications set paid_at = now() where reference = '${reference}'`);
}

const adminLogin = await call('/api/auth/login', {
  method: 'POST', headers: { 'x-jc-client-key': ADMIN_CLIENT_KEY },
  body: { email: 'admin@jobconnect.example', password: ADMIN_PASSWORD }
});
const adminT = adminLogin.data.token;

console.log('\n=== 1. COMPTES ===');
const cand = await reg({ name: 'Amine Candidat', email: `c.${stamp}@example.com`, password: 'SuperSecret12345', role: 'candidate' }, true);
const rec = await reg({ name: 'Sofia Recruteur', email: `r.${stamp}@example.com`, password: 'SuperSecret12345', role: 'recruiter', company: 'Nordic Care AB' }, false);
check('candidat inscrit (gratuit, CV obligatoire)', cand.status === 201, JSON.stringify(cand.data).slice(0, 120));
check('recruteur inscrit', rec.status === 201, JSON.stringify(rec.data).slice(0, 120));
check('admin connecté via l’app', adminLogin.status === 200, adminLogin.status);
const candT = cand.data.token;
const recT = rec.data.token;

console.log('\n=== 2. ABONNEMENT OBLIGATOIRE AVANT PUBLICATION ===');
let r = await call('/api/jobs', {
  method: 'POST', token: recT,
  body: { title: 'ICU Nurse', company: 'Nordic Care AB', description: 'ICU role.', country: 'Sweden', contract_type: 'Permanent' }
});
check('publication refusée sans abonnement (402)', r.status === 402, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call('/api/subscriptions/checkout', { method: 'POST', token: recT, body: { plan: 'recruiter_pro' } });
check('checkout abonnement sans Stripe -> 503 explicite', r.status === 503 && /not configured|STRIPE/i.test(r.data.error || ''), `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

r = await call('/api/subscriptions', { method: 'POST', token: recT, body: { plan: 'recruiter_pro' } });
check('ancien endpoint renvoie vers Stripe (402)', r.status === 402, `${r.status}`);

r = await call('/api/subscriptions', { method: 'POST', token: candT, body: { plan: 'candidate_premium' } });
check('candidat : aucun abonnement requis', r.status === 200 && r.data.status === 'free', `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

console.log('\n=== 3. GRILLE TARIFAIRE ===');
r = await call('/api/plans');
const plans = r.data.plans || {};
check('Recruiter Pro à 95 USD/mois', plans.recruiter_pro && plans.recruiter_pro.amount_cents === 9500, JSON.stringify(plans.recruiter_pro || {}).slice(0, 100));
check('formule promotionnelle présente', !!plans.recruiter_promo && plans.recruiter_promo.promotional === true);
check('candidat gratuit', plans.candidate_premium && plans.candidate_premium.amount_cents === 0);

r = await call('/api/admin/settings', { token: adminT });
check('réglages accessibles à l’admin', r.status === 200 && r.data.settings.jobconnect_fee_cents >= 0, r.status);
check('intégrations signalées comme non configurées', r.data.integrations && r.data.integrations.payments === false && r.data.integrations.email === false, JSON.stringify(r.data.integrations));

r = await call('/api/admin/settings', { token: recT });
check('réglages interdits au recruteur', r.status === 403, r.status);

console.log('\n=== 4. CONTRAT PUBLIÉ PAR L’ADMIN AVEC PRIX CONFIGURABLE ===');
r = await call('/api/jobs', {
  method: 'POST', token: adminT,
  body: {
    title: 'Registered Nurse — ICU', company: 'Nordic Care AB', description: 'ICU nursing with relocation support.',
    country: 'Sweden', city: 'Stockholm', contract_type: 'Permanent', category: 'Healthcare & Nursing',
    recruiter_price_cents: 20000, visa_sponsorship: true, positions: 2
  }
});
const jobId = r.data.id;
check('admin publie directement', r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call('/api/jobs');
const job = (r.data.jobs || []).find((j) => j.id === jobId);
check('prix recruteur configurable repris', job && job.recruiter_price_cents === 20000, JSON.stringify(job && job.recruiter_price_cents));
check('candidat voit le détail du prix', job && job.pricing && job.pricing.fee_cents + job.pricing.recruiter_price_cents === job.pricing.total_cents, JSON.stringify(job && job.pricing));
check('visa sponsorship exposé', job && job.visa_sponsorship === true);

console.log('\n=== 5. CANDIDATURE + SLA 5–20 MINUTES ===');
const applyForm = new FormData();
applyForm.set('cv', pdf());
r = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: candT, form: applyForm });
const appRef = r.data.reference;
check('candidature enregistrée', r.status === 201 && !!appRef, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call(`/api/applications/track/${appRef}`);
let app = r.data.application;
check('statut initial = pending', app.status === 'pending', app.status);
check('délai cible 5–20 minutes exposé', app.sla && app.sla.target_min_minutes === 5 && app.sla.target_max_minutes === 20, JSON.stringify(app.sla));
check('échéance de réponse calculée', !!app.response_due_at, app.response_due_at);
check('prix total = frais + prix recruteur', app.total_cents === app.fee_cents + app.recruiter_price_cents, JSON.stringify({ f: app.fee_cents, r: app.recruiter_price_cents, t: app.total_cents }));
check('paiement non réglé au départ', !app.paid_at);

console.log('\n=== 6. PAIEMENT VISA/MASTERCARD (réel, non configuré ici) ===');
r = await call('/api/payments/checkout', { method: 'POST', token: candT, body: { reference: appRef } });
check('checkout refusé proprement sans clé Stripe', r.status === 503 && /not configured/i.test(r.data.error || ''), `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
check('aucun faux paiement créé', r.status !== 201);

r = await call('/api/payments/mine', { token: candT });
check('liste des paiements vide', (r.data.payments || []).length === 0, JSON.stringify(r.data).slice(0, 80));

r = await call('/api/payments/FAKE-REF/receipt.pdf', { token: candT });
check('reçu inexistant -> 404', r.status === 404, r.status);

r = await call('/api/webhooks/stripe', { method: 'POST', body: { type: 'x' }, headers: { 'stripe-signature': 't=1,v1=deadbeef' } });
check('webhook sans secret configuré -> 503', r.status === 503, r.status);

console.log('\n=== 7. DÉCISION + MOTIF OBLIGATOIRE ===');
r = await call(`/api/admin/applications/${appRef}`, { method: 'PATCH', token: adminT, body: { status: 'accepted' } });
check('acceptation sans motif acceptée', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call(`/api/applications/track/${appRef}`);
check('statut = accepted visible par le candidat', r.data.application.status === 'accepted', r.data.application.status);
check('réponse dans le délai cible', r.data.application.sla.within_target === true, JSON.stringify(r.data.application.sla));

r = await call(`/api/admin/applications/${appRef}`, { method: 'PATCH', token: adminT, body: { status: 'rejected' } });
check('rejet sans motif refusé (422)', r.status === 422, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call(`/api/admin/applications/${appRef}`, { method: 'PATCH', token: adminT, body: { status: 'rejected', decision_reason: 'no' } });
check('motif trop court refusé (422)', r.status === 422, r.status);

r = await call(`/api/admin/applications/${appRef}`, {
  method: 'PATCH', token: adminT,
  body: { status: 'rejected', decision_reason: 'The candidate licence is not recognised in Sweden.' }
});
check('rejet avec motif accepté', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call(`/api/applications/track/${appRef}`);
app = r.data.application;
check('statut = rejected', app.status === 'rejected', app.status);
check('motif visible par le candidat', /licence/.test(app.decision_reason || ''), app.decision_reason);
check('statut inconnu refusé', (await call(`/api/admin/applications/${appRef}`, { method: 'PATCH', token: adminT, body: { status: 'shortlisted' } })).status === 400);

console.log('\n=== 8. RECRUTEUR : ABONNEMENT ACTIF, PUBLICATION, DÉCISION ===');
// Simule un abonnement payé (ce que fait le webhook Stripe après confirmation).
const subGranted = await grantSubscription(rec.data.user.id);
check('abonnement actif enregistré', subGranted, 'grant failed');

r = await call('/api/jobs', {
  method: 'POST', token: recT,
  body: { title: 'Care Assistant', company: 'Nordic Care AB', description: 'Elderly care role.', country: 'Sweden', contract_type: 'Fixed-term', recruiter_price_cents: 12000 }
});
const recJobId = r.data.id;
check('recruteur abonné peut publier', r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);

await call(`/api/admin/jobs/${recJobId}`, { method: 'PATCH', token: adminT, body: { status: 'published' } });
const apply3 = new FormData();
apply3.set('cv', pdf());
r = await call(`/api/jobs/${recJobId}/apply`, { method: 'POST', token: candT, form: apply3 });
const appRef3 = r.data.reference;
check('candidature sur offre recruteur', r.status === 201, r.status);

r = await call(`/api/recruiter/applications/${appRef3}/decision`, { method: 'PATCH', token: recT, body: { status: 'accepted' } });
check('décision bloquée tant que le candidat n’a pas payé (402)', r.status === 402, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

// Simule la confirmation de paiement (webhook Stripe).
await markPaid(appRef3);
r = await call(`/api/recruiter/applications/${appRef3}/decision`, { method: 'PATCH', token: recT, body: { status: 'rejected' } });
check('rejet recruteur sans motif refusé (422)', r.status === 422, r.status);

r = await call(`/api/recruiter/applications/${appRef3}/decision`, {
  method: 'PATCH', token: recT, body: { status: 'rejected', decision_reason: 'Applicant lacks the required B1 Swedish level.' }
});
check('recruteur rejette avec motif après paiement', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);

r = await call(`/api/applications/track/${appRef3}`);
check('candidat voit le rejet motivé', r.data.application.status === 'rejected' && /Swedish/.test(r.data.application.decision_reason || ''), JSON.stringify(r.data.application).slice(0, 160));

console.log('\n=== 9. E-MAILS (journalisés, jamais simulés) ===');
r = await call('/api/admin/email-log', { token: adminT });
check('journal e-mail accessible à l’admin', r.status === 200 && Array.isArray(r.data.emails), r.status);
const skipped = (r.data.emails || []).filter((e) => e.status === 'skipped');
check('e-mails enregistrés comme "skipped", pas "sent"', skipped.length > 0, `${(r.data.emails || []).length} entrées`);

console.log('\n=== 10. DASHBOARD ADMIN ===');
r = await call('/api/admin/overview', { token: adminT });
check('revenus exposés', r.data.revenue && typeof r.data.revenue.total_cents === 'number', JSON.stringify(r.data.revenue || {}).slice(0, 120));
check('SLA agrégé', r.data.sla && r.data.sla.target_max_minutes === 20, JSON.stringify(r.data.sla || {}).slice(0, 120));
check('abonnements actifs comptés', typeof r.data.active_subscriptions === 'number');
check('intégrations signalées', r.data.integrations && r.data.integrations.payments === false);

console.log('\n=== 11. SÉCURITÉ ===');
r = await call('/api/admin/settings', { token: candT });
check('réglages interdits au candidat', r.status === 403, r.status);
r = await call('/api/admin/overview');
check('dashboard exige une session', r.status === 401, r.status);
r = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@jobconnect.example', password: ADMIN_PASSWORD } });
check('admin bloqué sur le web', r.status === 403, r.status);
r = await call(`/api/applications/track/${appRef}`);
check('suivi public sans authentification', r.status === 200, r.status);

console.log('\n=== 12. INTERFACE ===');
const home = await (await fetch(BASE + '/')).text();
check('offre Recruiter Pro 95 USD affichée', home.includes('$95.00'));
check('formule promo affichée', home.includes('Recruiter Promo'));
check('candidat gratuit affiché', /Free/.test(home));
check('script de paiement chargé', home.includes('payment.js'));
check('aucune référence admin sur le site', !/admin/i.test(home));
for (const f of ['/payment.js', '/catalog.js', '/theme.css']) {
  const res = await fetch(BASE + f);
  check('asset ' + f, res.status === 200, res.status);
}

console.log(`\n${'='.repeat(56)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
