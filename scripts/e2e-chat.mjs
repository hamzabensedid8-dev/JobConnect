/**
 * End-to-end tests for messaging + notifications.
 * BASE=https://... ADMIN_PASSWORD=... ADMIN_CLIENT_KEY=... node scripts/e2e-chat.mjs
 */
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE || 'https://jc.jobconnectdz.workers.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (await readFile('/tmp/jc/admin_pw.txt', 'utf8')).trim();
const ADMIN_CLIENT_KEY = process.env.ADMIN_CLIENT_KEY || (await readFile('/tmp/jc/adminkey.txt', 'utf8')).trim();

let pass = 0, fail = 0;
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
  return { status: res.status, data };
}

const pdf = () => new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' });
const stamp = Date.now();

function reg(fields, withCv) {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.set(k, v));
  if (withCv) f.set('cv', pdf());
  return call('/api/auth/register', { method: 'POST', form: f });
}

console.log('\n=== SETUP ===');
const candEmail = `chatcand.${stamp}@example.com`;
const recEmail = `chatrec.${stamp}@example.com`;
const cand2Email = `chatcand2.${stamp}@example.com`;

const cand = await reg({ name: 'Karim Candidat', email: candEmail, password: 'SuperSecret12345', role: 'candidate' }, true);
const rec = await reg({ name: 'Nadia Recruteur', email: recEmail, password: 'SuperSecret12345', role: 'recruiter', company: 'Nordic Care AB' }, false);
const cand2 = await reg({ name: 'Leila Autre', email: cand2Email, password: 'SuperSecret12345', role: 'candidate' }, true);
check('candidate registered', cand.status === 201, JSON.stringify(cand.data).slice(0, 120));
check('recruiter registered', rec.status === 201, JSON.stringify(rec.data).slice(0, 120));

const candT = cand.data.token, recT = rec.data.token, cand2T = cand2.data.token;

const adminLogin = await call('/api/auth/login', {
  method: 'POST',
  headers: { 'x-jc-client-key': ADMIN_CLIENT_KEY },
  body: { email: 'admin@jobconnect.example', password: ADMIN_PASSWORD }
});
const adminT = adminLogin.data.token;
check('admin logs in from the app client', adminLogin.status === 200 && !!adminT, `got ${adminLogin.status}`);

const noKey = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@jobconnect.example', password: ADMIN_PASSWORD }
});
check('admin login blocked on the web (no client key)', noKey.status === 403, `got ${noKey.status}`);

const job = await call('/api/jobs', {
  method: 'POST', token: recT,
  body: { title: 'ICU Nurse', company: 'Nordic Care AB', description: 'Stockholm ICU role.', country: 'Sweden', contract_type: 'Permanent' }
});
await call(`/api/admin/jobs/${job.data.id}`, { method: 'PATCH', token: adminT, body: { status: 'published' } });
check('job published', job.status === 201, JSON.stringify(job.data).slice(0, 120));

console.log('\n=== CANDIDATE <-> RECRUITER ===');
let r = await call('/api/chat/conversations', {
  method: 'POST', token: candT, body: { kind: 'recruiter', job_id: job.data.id }
});
const recConvId = r.data.conversation && r.data.conversation.id;
check('candidate opens chat with the job recruiter', r.status === 201 && !!recConvId, JSON.stringify(r.data).slice(0, 200));
check('conversation linked to the job recruiter',
  r.data.conversation && r.data.conversation.recruiter_id === rec.data.user.id,
  JSON.stringify(r.data.conversation || {}).slice(0, 200));

r = await call('/api/chat/conversations', { method: 'POST', token: candT, body: { kind: 'recruiter', job_id: job.data.id } });
check('reopening reuses the same thread (no duplicates)', r.data.conversation && r.data.conversation.id === recConvId);

r = await call(`/api/chat/conversations/${recConvId}/messages`, {
  method: 'POST', token: candT, body: { body: 'Hello, I am interested in the ICU position.' }
});
check('candidate sends a message', r.status === 201 && r.data.message.body.includes('ICU'), `got ${r.status}`);

r = await call('/api/notifications', { token: recT });
const recNotif = (r.data.notifications || []).find((n) => n.type === 'new_message');
check('recruiter receives a message notification', !!recNotif, JSON.stringify(r.data).slice(0, 200));

r = await call(`/api/chat/conversations/${recConvId}/messages`, {
  method: 'POST', token: recT, body: { body: 'Thanks! Send me your resume please.' }
});
check('recruiter replies', r.status === 201, `got ${r.status}`);

r = await call(`/api/chat/conversations/${recConvId}/messages`, { token: candT });
check('candidate sees both messages', (r.data.messages || []).length === 2, JSON.stringify(r.data).slice(0, 200));

r = await call('/api/chat/conversations', { token: candT });
const convRow = (r.data.conversations || [])[0];
check('conversation list shows unread count', !!convRow && convRow.unread >= 1, JSON.stringify(convRow || {}).slice(0, 200));

await call(`/api/chat/conversations/${recConvId}/read`, { method: 'POST', token: candT });
r = await call('/api/chat/conversations', { token: candT });
check('marking read clears the badge', (r.data.conversations || [])[0].unread === 0);

console.log('\n=== CANDIDATE <-> ADMIN ===');
r = await call('/api/chat/conversations', { method: 'POST', token: candT, body: { kind: 'admin' } });
const admConvId = r.data.conversation && r.data.conversation.id;
check('candidate opens a support chat', r.status === 201 && !!admConvId, JSON.stringify(r.data).slice(0, 150));

r = await call(`/api/chat/conversations/${admConvId}/messages`, {
  method: 'POST', token: candT, body: { body: 'Bonjour, où en est ma demande ?' }
});
check('candidate messages the admin', r.status === 201, `got ${r.status}`);

r = await call('/api/notifications', { token: adminT });
check('admin is notified of the support message',
  (r.data.notifications || []).some((n) => n.type === 'new_message' && n.conversation_id === admConvId),
  JSON.stringify(r.data).slice(0, 200));

r = await call(`/api/chat/conversations/${admConvId}/messages`, {
  method: 'POST', token: adminT, body: { body: 'Bonjour, votre dossier est en cours de traitement.' }
});
check('admin replies to the candidate', r.status === 201, `got ${r.status}`);

r = await call('/api/notifications', { token: candT });
check('candidate is notified of the admin reply',
  (r.data.notifications || []).some((n) => n.conversation_id === admConvId), JSON.stringify(r.data).slice(0, 200));

console.log('\n=== PRIVACY ===');
r = await call(`/api/chat/conversations/${recConvId}/messages`, { token: cand2T });
check('another candidate cannot read the thread', r.status === 404, `got ${r.status}`);

r = await call(`/api/chat/conversations/${admConvId}/messages`, { token: recT });
check('an unrelated recruiter cannot read a support thread', r.status === 404, `got ${r.status}`);

r = await call(`/api/chat/conversations/${recConvId}/messages`);
check('chat requires authentication', r.status === 401, `got ${r.status}`);

r = await call('/api/chat/conversations', {
  method: 'POST', token: recT, body: { kind: 'recruiter', candidate_id: cand2.data.user.id }
});
check('recruiter can start a chat with a candidate', r.status === 201, `got ${r.status}`);

console.log('\n=== ADMIN DELETION (both sides) ===');
r = await call(`/api/chat/conversations/${recConvId}/messages`, { token: adminT });
const firstMsg = (r.data.messages || [])[0];
check('admin can read any conversation', !!firstMsg);

r = await call(`/api/admin/chat/messages/${firstMsg.id}`, { method: 'DELETE', token: candT });
check('candidate cannot delete a message', r.status === 403, `got ${r.status}`);

r = await call(`/api/admin/chat/messages/${firstMsg.id}`, { method: 'DELETE', token: recT });
check('recruiter cannot delete a message', r.status === 403, `got ${r.status}`);

r = await call(`/api/admin/chat/messages/${firstMsg.id}`, { method: 'DELETE', token: adminT });
check('admin deletes a message', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);

const candView = await call(`/api/chat/conversations/${recConvId}/messages`, { token: candT });
const recView = await call(`/api/chat/conversations/${recConvId}/messages`, { token: recT });
const adminView = await call(`/api/chat/conversations/${recConvId}/messages`, { token: adminT });
check('message is gone for the candidate', !candView.data.messages.some((m) => m.id === firstMsg.id));
check('message is gone for the recruiter', !recView.data.messages.some((m) => m.id === firstMsg.id));
check('message is gone for the admin too', !adminView.data.messages.some((m) => m.id === firstMsg.id));

r = await call(`/api/admin/chat/conversations/${recConvId}`, { method: 'DELETE', token: adminT });
check('admin deletes the whole conversation', r.status === 200, `got ${r.status}`);
r = await call(`/api/chat/conversations/${recConvId}/messages`, { token: candT });
check('deleted conversation is unavailable to the candidate', r.status === 404, `got ${r.status}`);

console.log('\n=== NOTIFICATIONS ON BUSINESS EVENTS ===');
const reqForm = new FormData();
reqForm.set('full_name', 'Sami Demande');
reqForm.set('email', `sami.${stamp}@example.com`);
reqForm.set('target_country', 'Norway');
reqForm.set('profession', 'Electrician');
reqForm.set('contract_type', 'Permanent');
r = await call('/api/applications', { method: 'POST', form: reqForm });
check('public request accepted', r.status === 201);

r = await call('/api/notifications', { token: adminT });
check('admin notified of a new contract request',
  (r.data.notifications || []).some((n) => n.type === 'new_request'), JSON.stringify(r.data).slice(0, 200));

const applyForm = new FormData();
applyForm.set('cv', pdf());
r = await call(`/api/jobs/${job.data.id}/apply`, { method: 'POST', token: cand2T, form: applyForm });
check('candidate applies', r.status === 201, `got ${r.status}`);

r = await call('/api/notifications', { token: recT });
check('recruiter notified of a new application',
  (r.data.notifications || []).some((n) => n.type === 'new_application'), JSON.stringify(r.data).slice(0, 200));

r = await call('/api/notifications', { token: recT });
const before = r.data.unread_count;
r = await call('/api/notifications/read', { method: 'POST', token: recT, body: { all: true } });
r = await call('/api/notifications', { token: recT });
check('mark-all-read works', before > 0 && r.data.unread_count === 0, `before=${before} after=${r.data.unread_count}`);

console.log('\n=== ASSETS ===');
r = await call('/chat.js');
check('chat.js is served', r.status === 200, `got ${r.status}`);
r = await call('/');
check('homepage has no admin reference', !/admin/i.test(r.data.raw || ''));

console.log(`\n${'='.repeat(52)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
