/**
 * End-to-end smoke test against the deployed Worker.
 * Usage: BASE=https://... ADMIN_PASSWORD=... node scripts/e2e-test.mjs
 */
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE || 'https://jobconnect-api.jobconnect-hbz.workers.dev';
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  (await readFile(process.env.ADMIN_PASSWORD_FILE || '.admin-password', 'utf8').catch(() => '')).trim();

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} :: ${detail}`);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

async function call(path, { method = 'GET', token, body, form, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, headers: res.headers };
}

function pdf(name = 'cv.pdf') {
  return new File([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF')], name, {
    type: 'application/pdf'
  });
}

function candidateForm(email) {
  const f = new FormData();
  f.set('name', 'Amine Testeur');
  f.set('email', email);
  f.set('password', 'SuperSecret12345');
  f.set('role', 'candidate');
  f.set('country', 'Algeria');
  f.set('cv', pdf());
  return f;
}

function recruiterForm(email) {
  const f = new FormData();
  f.set('name', 'Sofia Recruteuse');
  f.set('email', email);
  f.set('password', 'SuperSecret12345');
  f.set('role', 'recruiter');
  f.set('company', 'Global Talent Ltd');
  f.set('country', 'Canada');
  return f;
}

const stamp = Date.now();
const candEmail = `cand.${stamp}@example.com`;
const recEmail = `rec.${stamp}@example.com`;

console.log('\n=== AUTH & REGISTRATION ===');
const noCv = candidateForm(`nocv.${stamp}@example.com`);
noCv.delete('cv');
let r = await call('/api/auth/register', { method: 'POST', form: noCv });
check('candidate without CV rejected', r.status === 400, `got ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call('/api/auth/register', { method: 'POST', form: candidateForm(candEmail) });
const candToken = r.data.token;
check('candidate registers with CV', r.status === 201 && !!candToken, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
check('register returns safe user (no password)', r.data.user && !('password_hash' in r.data.user));

r = await call('/api/auth/register', { method: 'POST', form: candidateForm(candEmail) });
check('duplicate email rejected', r.status === 409, `got ${r.status}`);

r = await call('/api/auth/login', { method: 'POST', body: { email: candEmail, password: 'wrongpassword' } });
check('bad password rejected', r.status === 401, `got ${r.status}`);

r = await call('/api/auth/login', { method: 'POST', body: { email: candEmail, password: 'SuperSecret12345' } });
check('candidate logs in', r.status === 200 && !!r.data.token, `got ${r.status}`);

r = await call('/api/auth/me', { token: candToken });
check('auth/me returns the candidate', r.status === 200 && r.data.user.email === candEmail, `got ${r.status}`);

r = await call('/api/auth/me', { token: 'not.a.token' });
check('invalid token rejected', r.status === 401, `got ${r.status}`);

r = await call('/api/auth/register', { method: 'POST', form: recruiterForm(recEmail) });
const recToken = r.data.token;
check('recruiter registers without CV', r.status === 201 && !!recToken, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

const ADMIN_CLIENT_KEY = process.env.ADMIN_CLIENT_KEY || (await readFile('/tmp/jc/adminkey.txt', 'utf8').catch(() => '')).trim();
r = await call('/api/auth/login', {
  method: 'POST',
  headers: { 'x-jc-client-key': ADMIN_CLIENT_KEY },
  body: { email: 'admin@jobconnect.example', password: ADMIN_PASSWORD }
});
const adminToken = r.data.token;
check('admin logs in', r.status === 200 && !!adminToken, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

console.log('\n=== PUBLIC CONTRACT REQUEST + TRACKING ===');
const reqForm = new FormData();
reqForm.set('full_name', 'Yacine Public');
reqForm.set('email', `public.${stamp}@example.com`);
reqForm.set('phone', '+213 555 00 00 00');
reqForm.set('nationality', 'Algerian');
reqForm.set('residence_country', 'Algeria');
reqForm.set('target_country', 'Germany');
reqForm.set('profession', 'Nurse');
reqForm.set('contract_type', 'Permanent');
reqForm.set('experience', '2–5 years');
reqForm.set('message', 'Looking for a nursing contract abroad.');
reqForm.set('cv', pdf());
r = await call('/api/applications', { method: 'POST', form: reqForm });
const publicRef = r.data.reference;
check('public request accepted', r.status === 201 && /^JC-\d{4}-[0-9A-F]{10}$/.test(publicRef || ''), `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call(`/api/applications/track/${publicRef}`);
check('track by reference works', r.status === 200 && r.data.application.reference === publicRef, `got ${r.status}`);

r = await call('/api/applications/track/JC-2026-DOESNOTEX');
check('unknown reference -> 404', r.status === 404, `got ${r.status}`);

r = await call('/api/applications/track/' + publicRef.toLowerCase());
check('tracking is case-insensitive', r.status === 200, `got ${r.status}`);

reqForm.set('target_country', '');
r = await call('/api/applications', { method: 'POST', form: reqForm });
check('missing required field rejected', r.status === 400, `got ${r.status}`);

console.log('\n=== JOBS ===');
r = await call('/api/jobs', {
  method: 'POST',
  token: recToken,
  body: {
    title: 'Registered Nurse — ICU',
    company: 'Global Talent Ltd',
    description: 'ICU nursing position with relocation support.',
    country: 'Canada',
    city: 'Toronto',
    contract_type: 'Permanent',
    workplace: 'On-site',
    salary: 'CAD 75,000',
    category: 'Healthcare'
  }
});
const jobId = r.data.id;
check('recruiter posts a job (pending)', r.status === 201 && r.data.status === 'pending', `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call('/api/jobs', { method: 'POST', token: candToken, body: { title: 'x', company: 'y', description: 'z', country: 'w', contract_type: 'Permanent' } });
check('candidate cannot post a job', r.status === 403, `got ${r.status}`);

r = await call('/api/jobs');
check('pending job not publicly visible', !r.data.jobs.some((j) => j.id === jobId));

r = await call(`/api/admin/jobs/${jobId}`, { method: 'PATCH', token: adminToken, body: { status: 'published' } });
check('admin publishes the job', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call('/api/jobs');
check('published job is listed', r.data.jobs.some((j) => j.id === jobId));

r = await call('/api/jobs?country=canada');
check('country filter works', r.data.jobs.every((j) => /canada/i.test(j.country)), JSON.stringify(r.data.jobs.map((j) => j.country)));

r = await call('/api/jobs?q=Nurse');
check('text search works', r.data.jobs.some((j) => j.id === jobId), JSON.stringify(r.data.jobs.map((j) => j.title)));

r = await call('/api/jobs?type=Internship');
check('contract type filter works', r.data.jobs.every((j) => j.contract_type === 'Internship'));

console.log('\n=== APPLYING & RESUMES ===');
const applyForm = new FormData();
applyForm.set('cv', pdf('my-cv.pdf'));
r = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: candToken, form: applyForm });
const appRef = r.data.reference;
check('candidate applies to job', r.status === 201 && !!appRef, `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: recToken, form: new FormData() });
check('recruiter cannot apply', r.status === 403, `got ${r.status}`);

const badForm = new FormData();
badForm.set('cv', new File([Buffer.from('MZ')], 'virus.exe', { type: 'application/x-msdownload' }));
r = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: candToken, form: badForm });
check('non-PDF/DOC extension rejected', r.status >= 400, `got ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

r = await call('/api/recruiter/applications', { token: recToken });
const recApps = r.data.applications || [];
check('recruiter sees the application', recApps.some((a) => a.reference === appRef), JSON.stringify(recApps).slice(0, 200));
check('application flags has_cv', recApps.some((a) => a.reference === appRef && a.has_cv === true));

r = await call(`/api/recruiter/applications/${appRef}/cv`, { token: recToken });
const cvText = await r.text?.() ?? '';
check('recruiter downloads the CV', r.status === 200, `got ${r.status}`);

r = await call(`/api/recruiter/applications/${appRef}/cv`, { token: candToken });
check('candidate cannot download recruiter CV endpoint', r.status === 403, `got ${r.status}`);

r = await call(`/api/recruiter/applications/${appRef}/cv`);
check('CV download requires auth', r.status === 401, `got ${r.status}`);

r = await call('/api/candidate/applications', { token: candToken });
check('candidate sees their application history', (r.data.applications || []).some((a) => a.reference === appRef), JSON.stringify(r.data).slice(0, 200));

r = await call('/api/candidate/applications', { token: recToken });
check('recruiter cannot read candidate endpoint', r.status === 403, `got ${r.status}`);

console.log('\n=== ADMIN WORKFLOW ===');
r = await call(`/api/admin/applications/${appRef}`, {
  method: 'PATCH',
  token: adminToken,
  body: { status: 'shortlisted', admin_note: 'Profile shortlisted for interview.' }
});
check('admin updates application status', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call(`/api/applications/track/${appRef}`);
check('candidate sees new status when tracking', r.data.application.status === 'shortlisted', JSON.stringify(r.data.application));
check('admin note is exposed when tracking', r.data.application.admin_note === 'Profile shortlisted for interview.');

r = await call(`/api/admin/applications/${appRef}`, { method: 'PATCH', token: adminToken, body: { status: 'nonsense' } });
check('admin invalid status rejected', r.status === 400, `got ${r.status}`);

r = await call('/api/admin/overview', { token: adminToken });
check('admin overview aggregates data', r.status === 200 && Array.isArray(r.data.latestApplications) && r.data.users.length > 0, `got ${r.status}`);

r = await call('/api/admin/overview', { token: recToken });
check('recruiter cannot read admin overview', r.status === 403, `got ${r.status}`);

r = await call('/api/admin/overview');
check('admin overview requires auth', r.status === 401, `got ${r.status}`);

console.log('\n=== SUBSCRIPTIONS ===');
r = await call('/api/subscriptions', { method: 'POST', token: candToken, body: { plan: 'candidate_premium' } });
check('candidate requests Candidate Premium', r.status === 201 && r.data.status === 'pending_payment', `got ${r.status} ${JSON.stringify(r.data)}`);

r = await call('/api/subscriptions', { method: 'POST', token: candToken, body: { plan: 'recruiter_premium' } });
check('candidate cannot buy recruiter plan', r.status === 400, `got ${r.status}`);

r = await call('/api/subscriptions/me', { token: candToken });
check('candidate lists own subscriptions', (r.data.subscriptions || []).length > 0, JSON.stringify(r.data).slice(0, 150));

r = await call('/api/admin/subscriptions', { token: adminToken });
check('admin lists all subscriptions', r.status === 200 && r.data.subscriptions.length > 0, `got ${r.status}`);

console.log('\n=== STATIC FRONTEND ===');
r = await call('/');
check('index.html served', r.status === 200 && /JobConnect/.test(r.data.raw || ''), `got ${r.status}`);
r = await call('/style.css');
check('style.css served', r.status === 200, `got ${r.status}`);
r = await call('/app.js');
check('app.js served', r.status === 200, `got ${r.status}`);
r = await call('/api/unknown-endpoint');
check('unknown API route -> 404 json', r.status === 404, `got ${r.status}`);

console.log(`\n${'='.repeat(50)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log("Artifacts: publicRef=" + publicRef + " appRef=" + appRef + " jobId=" + jobId);
