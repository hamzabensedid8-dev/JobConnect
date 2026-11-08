/**
 * JobConnect — Cloudflare Worker API
 *
 * Replaces the original Express + SQLite server.
 *  - Postgres (Supabase) for data, accessed through PostgREST with the service_role key.
 *  - Supabase Storage (private bucket "cvs") for resumes.
 *  - Password hashing delegated to Postgres/pgcrypto (bcrypt) to stay inside the
 *    Worker CPU budget.
 *  - HS256 JWTs signed with WebCrypto.
 *
 * `__ASSETS__` is injected at build time by build.js (index.html, style.css, app.js).
 */

/* global __ASSETS__ */

const ONE_DAY = 60 * 60 * 24;
const MAX_CV_BYTES = 5 * 1024 * 1024;
const ALLOWED_CV_EXT = ['.pdf', '.doc', '.docx'];
const JWT_TTL_SECONDS = 12 * 60 * 60;

const APPLICATION_STATUSES = ['received', 'under_review', 'shortlisted', 'approved', 'rejected', 'completed'];
const JOB_STATUSES = ['pending', 'published', 'rejected', 'closed'];

const PREMIUM_PLANS = {
  candidate_premium: { role: 'candidate', amount_cents: 799, currency: 'USD', name: 'Candidate Premium' },
  recruiter_premium: { role: 'recruiter', amount_cents: 2999, currency: 'USD', name: 'Recruiter Premium' }
};

/* ------------------------------------------------------------------ utils */

const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}

function bytesFromB64url(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-jc-client-key',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  };
}

function str(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function randomReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `JC-${new Date().getUTCFullYear()}-${hex}`;
}

function extensionOf(filename) {
  const idx = String(filename || '').lastIndexOf('.');
  return idx === -1 ? '' : String(filename).slice(idx).toLowerCase();
}

/* -------------------------------------------------------------- multipart */

const CRLF = new Uint8Array([13, 10]);
const HEADER_SEP = new Uint8Array([13, 10, 13, 10]);
const DECODER = new TextDecoder();

function indexOfSeq(haystack, needle, from = 0) {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Parses multipart/form-data directly from the request bytes.
 * request.formData() in the Workers runtime can flatten file parts to strings,
 * so this keeps binary resumes intact.
 */
async function parseMultipart(request) {
  const contentType = request.headers.get('content-type') || '';
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!match) return null;

  const boundary = (match[1] || match[2]).trim();
  const bytes = new Uint8Array(await request.arrayBuffer());
  const delimiter = enc.encode(`--${boundary}`);

  const fields = {};
  const files = {};

  let cursor = indexOfSeq(bytes, delimiter, 0);
  while (cursor !== -1) {
    let start = cursor + delimiter.length;
    // Closing delimiter: "--boundary--"
    if (bytes[start] === 45 && bytes[start + 1] === 45) break;
    if (bytes[start] === CRLF[0] && bytes[start + 1] === CRLF[1]) start += 2;

    const next = indexOfSeq(bytes, delimiter, start);
    if (next === -1) break;

    let end = next;
    if (end >= 2 && bytes[end - 2] === CRLF[0] && bytes[end - 1] === CRLF[1]) end -= 2;

    const part = bytes.subarray(start, end);
    const sep = indexOfSeq(part, HEADER_SEP, 0);

    if (sep !== -1) {
      const headerText = DECODER.decode(part.subarray(0, sep));
      const body = part.subarray(sep + 4);
      const name = /name="([^"]*)"/i.exec(headerText);
      const filename = /filename="([^"]*)"/i.exec(headerText);
      const type = /content-type:\s*([^\r\n]+)/i.exec(headerText);

      if (name && name[1]) {
        if (filename && filename[1]) {
          files[name[1]] = {
            name: filename[1],
            type: type ? type[1].trim() : 'application/octet-stream',
            size: body.length,
            _bytes: body
          };
        } else {
          fields[name[1]] = DECODER.decode(body);
        }
      }
    }
    cursor = next;
  }

  return { fields, files };
}

/* --------------------------------------------------------------- Supabase */

function supabaseHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    ...extra
  };
}

/** Call PostgREST. `path` is everything after /rest/v1/. */
async function rest(env, path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const h = supabaseHeaders(env, headers);
  if (body !== undefined) h['content-type'] = 'application/json';
  if (prefer) h.prefer = prefer;

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message = (data && data.message) || (typeof data === 'string' ? data : `Supabase error (${res.status})`);
    throw new Error(message);
  }
  return data;
}

async function rpc(env, fn, args) {
  return rest(env, `rpc/${fn}`, { method: 'POST', body: args });
}

/** Upload a resume to the private bucket. Returns the object path. */
async function uploadCv(env, file, ownerKey) {
  if (!file || typeof file === 'string') return null;
  if (typeof file.size === 'number' && file.size === 0) return null;

  const ext = extensionOf(file.name);
  if (!ALLOWED_CV_EXT.includes(ext)) {
    throw new Error('CV format not accepted. Use PDF, DOC or DOCX.');
  }
  if (file.size > MAX_CV_BYTES) {
    throw new Error('The resume exceeds the 5 MB limit.');
  }

  const objectPath = `${ownerKey}/${crypto.randomUUID()}${ext}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/cvs/${objectPath}`, {
    method: 'POST',
    headers: supabaseHeaders(env, {
      'content-type': file.type || 'application/octet-stream',
      'x-upsert': 'true'
    }),
    body: file._bytes ? file._bytes : await file.arrayBuffer()
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not store the resume (${res.status}). ${detail}`.trim());
  }
  return objectPath;
}

async function downloadCv(env, objectPath, filename) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/cvs/${objectPath}`, {
    headers: supabaseHeaders(env)
  });
  if (!res.ok) throw new Error('Resume not found.');
  const headers = new Headers(res.headers);
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  headers.set('cache-control', 'private, no-store');
  for (const key of Object.keys(corsHeaders())) headers.set(key, corsHeaders()[key]);
  return new Response(res.body, { status: 200, headers });
}

/* ----------------------------------------------------------- notifications */

/** Create an in-app notification. Never throws: notifications are best effort. */
async function notify(env, userId, { type, title, body = null, conversation_id = null, application_ref = null }) {
  try {
    await rest(env, 'notifications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { user_id: userId, type, title, body, conversation_id, application_ref }
    });
  } catch (err) {
    console.error('notify failed:', err && err.message ? err.message : err);
  }
}

async function notifyAdmins(env, payload) {
  try {
    const admins = await rest(env, 'users?role=eq.admin&select=id');
    await Promise.all((admins || []).map((a) => notify(env, a.id, payload)));
  } catch (err) {
    console.error('notifyAdmins failed:', err && err.message ? err.message : err);
  }
}

/* --------------------------------------------------------------------- JWT */

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);
}

async function signToken(payload, secret) {
  const header = b64urlFromString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlFromString(
    JSON.stringify({ ...payload, iat: now, exp: now + JWT_TTL_SECONDS })
  );
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlFromBytes(sig)}`;
}

async function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token.');

  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    bytesFromB64url(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error('Invalid signature.');

  const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[1])));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Session expired.');
  return payload;
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function requireAuth(request, env) {
  const token = bearer(request);
  if (!token) return null;
  try {
    return await verifyToken(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function currentUser(env, claims) {
  const rows = await rest(env, `users?id=eq.${encodeURIComponent(claims.id)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company: user.company,
    country: user.country
  };
}

/* -------------------------------------------------------------- rate limit */

const buckets = new Map();

function rateLimit(key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const entry = buckets.get(key);
  if (!entry || now - entry.start > windowSeconds) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/* -------------------------------------------------------------- API router */

async function handleApi(request, url, env) {
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const claims = await requireAuth(request, env);
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

  /* -------------------------------------------------------------- health */
  if (path === '/api/health') {
    return json({ status: 'ok', runtime: 'cloudflare-workers' });
  }

  /* ---------------------------------------------------------------- auth */

  if (path === '/api/auth/register' && method === 'POST') {
    if (!rateLimit(`register:${clientIp}`, 10, 3600)) {
      return fail('Too many account creations from this address. Please try again later.', 429);
    }

    const contentType = request.headers.get('content-type') || '';
    let fields = {};
    let cvFile = null;

    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseMultipart(request);
      fields = (parsed && parsed.fields) || {};
      cvFile = (parsed && parsed.files && parsed.files.cv) || null;
    } else {
      fields = await request.json().catch(() => ({}));
    }

    const name = str(fields.name, 120);
    const email = str(fields.email, 200)?.toLowerCase();
    const password = String(fields.password || '');
    const role = str(fields.role, 20) || 'candidate';

    if (!name || !email || !password) {
      return fail('Name, email and password are required.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail('Please provide a valid email address.');
    }
    if (password.length < 10) {
      return fail('Password must be at least 10 characters long.');
    }
    if (!['candidate', 'recruiter'].includes(role)) {
      return fail('Invalid account type.');
    }
    if (role === 'candidate' && !cvFile) {
      return fail('A resume (PDF, DOC or DOCX) is required for candidate accounts.');
    }

    const existing = await rest(env, `users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length) {
      return fail('This email address is already in use.', 409);
    }

    const passwordHash = await rpc(env, 'jc_hash_password', { pw: password });
    if (typeof passwordHash !== 'string') throw new Error('Password hashing failed.');

    const inserted = await rest(env, 'users', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        name,
        email,
        password_hash: passwordHash,
        role,
        company: str(fields.company, 160),
        country: str(fields.country, 120)
      }
    });

    const user = inserted[0];
    if (cvFile) {
      try {
        const objectPath = await uploadCv(env, cvFile, `users/${user.id}`);
        if (objectPath) {
          await rest(env, `users?id=eq.${user.id}`, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { cv_path: objectPath }
          });
          user.cv_path = objectPath;
        }
      } catch (err) {
        // Roll back so the candidate can retry with a valid file.
        await rest(env, `users?id=eq.${user.id}`, { method: 'DELETE' });
        return fail(err.message, 400);
      }
    }

    const token = await signToken({ id: user.id, role: user.role }, env.JWT_SECRET);
    return json({ token, user: publicUser(user) }, 201);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    if (!rateLimit(`login:${clientIp}`, 25, 900)) {
      return fail('Too many attempts. Please try again in a few minutes.', 429);
    }
    const body = await request.json().catch(() => ({}));
    const email = str(body.email, 200)?.toLowerCase();
    const password = String(body.password || '');

    const rows = await rest(env, `users?email=eq.${encodeURIComponent(email || '')}&select=*`);
    const user = rows && rows[0];

    // Always run the comparison so timing does not leak account existence.
    const ok = await rpc(env, 'jc_verify_password', {
      pw: password,
      hashed: (user && user.password_hash) || '$2a$11$0000000000000000000000000000000000000000000000000000'
    });
    if (!user || !ok) {
      return fail('Incorrect email or password.', 401);
    }

    // The admin console only exists inside the Android application. An admin
    // account cannot obtain a session from the website: the official client
    // sends the shared client key, the browser never does.
    if (user.role === 'admin') {
      const provided = request.headers.get('x-jc-client-key') || '';
      const expected = env.ADMIN_CLIENT_KEY || '';
      if (!expected || provided !== expected) {
        return fail('This account is not available on the web version.', 403);
      }
    }

    const token = await signToken({ id: user.id, role: user.role }, env.JWT_SECRET);
    return json({ token, user: publicUser(user) });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const user = await currentUser(env, claims);
    if (!user) return fail('Account not found.', 401);
    return json({ user: publicUser(user) });
  }

  /* --------------------------------------------------------------- plans */

  if (path === '/api/plans' && method === 'GET') {
    return json({ plans: PREMIUM_PLANS, payment_enabled: false });
  }

  if (path === '/api/subscriptions' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['candidate', 'recruiter'].includes(claims.role)) {
      return fail('Access denied.', 403);
    }
    const body = await request.json().catch(() => ({}));
    const plan = PREMIUM_PLANS[body.plan];
    if (!plan || plan.role !== claims.role) {
      return fail('This premium plan is not available for your account type.');
    }
    const rows = await rest(env, 'subscriptions', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: claims.id,
        plan: body.plan,
        amount_cents: plan.amount_cents,
        currency: plan.currency,
        status: 'pending_payment'
      }
    });
    return json(
      {
        subscription_id: rows[0].id,
        plan: plan.name,
        amount_cents: plan.amount_cents,
        currency: plan.currency,
        status: 'pending_payment',
        message: 'Your subscription request is saved. Online payment is not enabled yet.'
      },
      201
    );
  }

  if (path === '/api/subscriptions/me' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const rows = await rest(
      env,
      `subscriptions?user_id=eq.${claims.id}&select=id,plan,amount_cents,currency,status,created_at&order=created_at.desc`
    );
    return json({ subscriptions: rows });
  }

  /* ---------------------------------------------------------------- jobs */

  if (path === '/api/jobs' && method === 'GET') {
    const params = new URLSearchParams({ select: '*' });
    params.set('status', 'eq.published');
    params.set('order', 'created_at.desc');
    params.set('limit', '100');

    const country = str(url.searchParams.get('country'), 120);
    const type = str(url.searchParams.get('type'), 60);
    const term = str(url.searchParams.get('q'), 120);

    if (country) params.append('country', `ilike.*${country}*`);
    if (type) params.append('contract_type', `eq.${type}`);
    if (term) {
      const safe = term.replace(/[,()*]/g, '');
      params.append('or', `(title.ilike.*${safe}*,company.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`);
    }

    const jobs = await rest(env, `jobs?${params.toString()}`);
    return json({ jobs: jobs || [] });
  }

  if (path === '/api/jobs' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['recruiter', 'admin'].includes(claims.role)) return fail('Access denied.', 403);

    const body = await request.json().catch(() => ({}));
    const title = str(body.title, 160);
    const company = str(body.company, 160);
    const description = str(body.description, 8000);
    const country = str(body.country, 120);
    const contractType = str(body.contract_type, 60);

    if (!title || !company || !description || !country || !contractType) {
      return fail('Please fill in all required fields.');
    }

    const status = claims.role === 'admin' ? 'published' : 'pending';
    const rows = await rest(env, 'jobs', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        recruiter_id: claims.id,
        title,
        company,
        description,
        country,
        city: str(body.city, 120),
        contract_type: contractType,
        workplace: str(body.workplace, 40) || 'On-site',
        salary: str(body.salary, 120),
        category: str(body.category, 120),
        status
      }
    });

    return json(
      {
        id: rows[0].id,
        status,
        message: status === 'published' ? 'Job published.' : 'Job saved. It will be published after review.'
      },
      201
    );
  }

  if (path === '/api/recruiter/jobs' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['recruiter', 'admin'].includes(claims.role)) return fail('Access denied.', 403);
    const filter = claims.role === 'admin' ? '' : `recruiter_id=eq.${claims.id}&`;
    const jobs = await rest(env, `jobs?${filter}select=*&order=created_at.desc`);
    return json({ jobs: jobs || [] });
  }

  const applyMatch = path.match(/^\/api\/jobs\/(\d+)\/apply$/);
  if (applyMatch && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'candidate') return fail('Log in with a candidate account to apply.', 403);

    const jobs = await rest(
      env,
      `jobs?id=eq.${applyMatch[1]}&status=eq.published&select=*`
    );
    const job = jobs && jobs[0];
    if (!job) return fail('Job not found.', 404);

    const user = await currentUser(env, claims);
    if (!user) return fail('Account not found.', 401);

    let cvPath = user.cv_path || null;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseMultipart(request);
      const file = parsed && parsed.files && parsed.files.cv;
      if (file) cvPath = await uploadCv(env, file, `applications/${user.id}`);
    }

    const reference = randomReference();
    await rest(env, 'applications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        reference,
        job_id: job.id,
        candidate_id: user.id,
        full_name: user.name,
        email: user.email,
        target_country: job.country,
        profession: job.title,
        contract_type: job.contract_type,
        message: `Application for job #${job.id}`,
        cv_path: cvPath
      }
    });

    await notify(env, job.recruiter_id, {
      type: 'new_application',
      title: 'New application',
      body: `${user.name} applied to "${job.title}"`,
      application_ref: reference
    });
    await notifyAdmins(env, {
      type: 'new_application',
      title: 'New application',
      body: `${user.name} → ${job.title} (${job.company})`,
      application_ref: reference
    });

    return json({ reference, message: 'Application recorded.' }, 201);
  }

  /* ------------------------------------------------- direct contract request */

  if (path === '/api/applications' && method === 'POST') {
    if (!rateLimit(`request:${clientIp}`, 20, 3600)) {
      return fail('Too many requests from this address. Please try again later.', 429);
    }

    const parsed = await parseMultipart(request);
    const fields = (parsed && parsed.fields) || {};
    const files = (parsed && parsed.files) || {};
    const fullName = str(fields.full_name, 160);
    const email = str(fields.email, 200)?.toLowerCase();
    const targetCountry = str(fields.target_country, 120);
    const profession = str(fields.profession, 160);
    const contractType = str(fields.contract_type, 60);

    if (!fullName || !email || !targetCountry || !profession || !contractType) {
      return fail('Please fill in all required fields.');
    }

    const reference = randomReference();
    let cvPath = null;
    if (files.cv) cvPath = await uploadCv(env, files.cv, `requests/${reference}`);

    // Link to an existing candidate account when the email matches.
    const candidates = await rest(
      env,
      `users?email=eq.${encodeURIComponent(email)}&role=eq.candidate&select=id`
    );
    const candidateId = candidates && candidates[0] ? candidates[0].id : null;

    await rest(env, 'applications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        reference,
        candidate_id: candidateId,
        full_name: fullName,
        email,
        phone: str(fields.phone, 60),
        nationality: str(fields.nationality, 120),
        residence_country: str(fields.residence_country, 120),
        target_country: targetCountry,
        profession,
        contract_type: contractType,
        experience: str(fields.experience, 60),
        message: str(fields.message, 4000),
        cv_path: cvPath
      }
    });

    await notifyAdmins(env, {
      type: 'new_request',
      title: 'New contract request',
      body: `${fullName} — ${profession} → ${targetCountry}`,
      application_ref: reference
    });

    return json(
      {
        reference,
        message: 'Your request has been received. Keep your reference code to track its progress.'
      },
      201
    );
  }

  const trackMatch = path.match(/^\/api\/applications\/track\/(.+)$/);
  if (trackMatch && method === 'GET') {
    const reference = decodeURIComponent(trackMatch[1]).toUpperCase();
    const fields =
      'reference,full_name,target_country,profession,contract_type,status,admin_note,created_at,updated_at';
    const rows = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}&select=${fields}`);
    if (!rows || !rows.length) return fail('No request found for this code.', 404);
    return json({ application: rows[0] });
  }

  if (path === '/api/candidate/applications' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'candidate') return fail('Access denied.', 403);
    const rows = await rest(
      env,
      `applications?candidate_id=eq.${claims.id}&select=reference,profession,target_country,contract_type,status,created_at,updated_at&order=created_at.desc`
    );
    return json({ applications: rows || [] });
  }

  /* ----------------------------------------------------------- recruiter */

  if (path === '/api/recruiter/applications' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['recruiter', 'admin'].includes(claims.role)) return fail('Access denied.', 403);

    const select =
      'reference,full_name,email,profession,target_country,status,cv_path,job_id,jobs!inner(title,recruiter_id)';
    const filter =
      claims.role === 'admin' ? '' : `jobs.recruiter_id=eq.${claims.id}&`;

    const rows = await rest(env, `applications?${filter}job_id=not.is.null&select=${select}&order=created_at.desc`);

    const applications = (rows || []).map(({ cv_path, jobs, ...rest_ }) => ({
      ...rest_,
      job_title: jobs ? jobs.title : null,
      has_cv: !!cv_path
    }));
    return json({ applications });
  }

  const recruiterCvMatch = path.match(/^\/api\/recruiter\/applications\/(.+)\/cv$/);
  if (recruiterCvMatch && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['recruiter', 'admin'].includes(claims.role)) return fail('Access denied.', 403);

    const reference = decodeURIComponent(recruiterCvMatch[1]).toUpperCase();
    const rows = await rest(
      env,
      `applications?reference=eq.${encodeURIComponent(reference)}&select=cv_path,job_id,jobs(title,recruiter_id)`
    );
    const row = rows && rows[0];
    if (!row || !row.cv_path) return fail('Resume not found.', 404);
    if (claims.role !== 'admin' && (!row.jobs || row.jobs.recruiter_id !== claims.id)) {
      return fail('Access denied.', 403);
    }
    return downloadCv(env, row.cv_path, `Resume-${reference}${extensionOf(row.cv_path)}`);
  }

  /* --------------------------------------------------------------- admin */

  if (path.startsWith('/api/admin/')) {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
  }

  if (path === '/api/admin/overview' && method === 'GET') {
    const [users, applications, jobs, subscriptions, latestApplications, latestJobs] = await Promise.all([
      rest(env, 'users?select=role'),
      rest(env, 'applications?select=status'),
      rest(env, 'jobs?select=status'),
      rest(env, 'subscriptions?select=status'),
      rest(
        env,
        'applications?select=reference,full_name,email,profession,target_country,status,created_at&order=created_at.desc&limit=30'
      ),
      rest(env, 'jobs?select=id,title,company,country,status,created_at&order=created_at.desc&limit=30')
    ]);

    const groupBy = (rows, key) => {
      const map = new Map();
      for (const row of rows || []) map.set(row[key], (map.get(row[key]) || 0) + 1);
      return Array.from(map, ([value, count]) => ({ [key]: value, count }));
    };

    return json({
      users: groupBy(users, 'role'),
      applications: groupBy(applications, 'status'),
      jobs: groupBy(jobs, 'status'),
      subscriptions: groupBy(subscriptions, 'status'),
      latestApplications: latestApplications || [],
      latestJobs: latestJobs || []
    });
  }

  if (path === '/api/admin/applications' && method === 'GET') {
    const rows = await rest(env, 'applications?select=*&order=created_at.desc');
    return json({ applications: rows || [] });
  }

  if (path === '/api/admin/subscriptions' && method === 'GET') {
    const rows = await rest(
      env,
      'subscriptions?select=*,users(name,email,role)&order=created_at.desc'
    );
    return json({ subscriptions: rows || [] });
  }

  const adminUserCvMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/cv$/);
  if (adminUserCvMatch && method === 'GET') {
    const rows = await rest(
      env,
      `users?id=eq.${encodeURIComponent(adminUserCvMatch[1])}&role=eq.candidate&select=cv_path,name`
    );
    const row = rows && rows[0];
    if (!row || !row.cv_path) return fail('Resume not found.', 404);
    return downloadCv(env, row.cv_path, `Resume-${String(row.name || 'candidate').replace(/[^\w-]/g, '_')}${extensionOf(row.cv_path)}`);
  }

  const adminAppMatch = path.match(/^\/api\/admin\/applications\/(.+)$/);
  if (adminAppMatch && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    if (!APPLICATION_STATUSES.includes(body.status)) return fail('Invalid status.');
    const reference = decodeURIComponent(adminAppMatch[1]).toUpperCase();

    const rows = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: body.status,
        admin_note: str(body.admin_note, 2000),
        updated_at: new Date().toISOString()
      }
    });
    if (!rows || !rows.length) return fail('Request not found.', 404);
    return json({ message: 'Request updated.' });
  }

  const adminJobMatch = path.match(/^\/api\/admin\/jobs\/(\d+)$/);
  if (adminJobMatch && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    if (!JOB_STATUSES.includes(body.status)) return fail('Invalid status.');
    const rows = await rest(env, `jobs?id=eq.${adminJobMatch[1]}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status: body.status }
    });
    if (!rows || !rows.length) return fail('Job not found.', 404);
    return json({ message: 'Job updated.' });
  }


  /* --------------------------------------------------------------- chat */

  const CONV_SELECT =
    'id,kind,candidate_id,recruiter_id,job_id,created_at,last_message_at,' +
    'candidate:users!conversations_candidate_id_fkey(name,email,role),' +
    'recruiter:users!conversations_recruiter_id_fkey(name,email,role,company)';

  function canAccess(conv, claims) {
    if (!conv || !claims) return false;
    if (claims.role === 'admin') return true;
    return conv.candidate_id === claims.id || conv.recruiter_id === claims.id;
  }

  async function loadConversation(env, id) {
    const rows = await rest(env, `conversations?id=eq.${encodeURIComponent(id)}&select=${CONV_SELECT}`);
    return rows && rows[0];
  }

  if (path === '/api/chat/conversations' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);

    const filter =
      claims.role === 'admin'
        ? ''
        : claims.role === 'candidate'
          ? `candidate_id=eq.${claims.id}&`
          : `recruiter_id=eq.${claims.id}&`;

    const conversations = (await rest(
      env,
      `conversations?${filter}select=${CONV_SELECT}&order=last_message_at.desc&limit=100`
    )) || [];

    if (!conversations.length) return json({ conversations: [] });

    const ids = conversations.map((c) => c.id).join(',');
    const [unread, latest] = await Promise.all([
      rest(env, `messages?conversation_id=in.(${ids})&read_at=is.null&deleted_at=is.null&select=conversation_id`),
      rest(
        env,
        `messages?conversation_id=in.(${ids})&deleted_at=is.null&select=conversation_id,body,sender_role,created_at&order=id.desc`
      )
    ]);

    const unreadByConv = {};
    for (const m of unread || []) {
      unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id] || 0) + 1;
    }
    const lastByConv = {};
    for (const m of latest || []) {
      if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;
    }

    return json({
      conversations: conversations.map((c) => ({
        ...c,
        unread: unreadByConv[c.id] || 0,
        last_message: lastByConv[c.id] || null
      }))
    });
  }

  if (path === '/api/chat/conversations' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);

    const body = await request.json().catch(() => ({}));
    const kind = body.kind === 'recruiter' ? 'recruiter_candidate' : 'admin_candidate';

    let candidateId = null;
    let recruiterId = null;
    let jobId = null;

    if (kind === 'admin_candidate') {
      if (claims.role === 'candidate') candidateId = claims.id;
      else if (claims.role === 'admin') candidateId = str(body.candidate_id, 60);
      else return fail('Access denied.', 403);
      if (!candidateId) return fail('candidate_id is required.');
    } else {
      if (claims.role === 'candidate') {
        // A candidate can only reach the recruiter who published the job.
        const jobIdIn = str(body.job_id, 40);
        if (!jobIdIn) return fail('job_id is required to contact a recruiter.');
        const jobs = await rest(env, `jobs?id=eq.${encodeURIComponent(jobIdIn)}&status=eq.published&select=id,recruiter_id,title`);
        const job = jobs && jobs[0];
        if (!job) return fail('Job not found.', 404);
        candidateId = claims.id;
        recruiterId = job.recruiter_id;
        jobId = job.id;
      } else if (claims.role === 'recruiter') {
        candidateId = str(body.candidate_id, 60);
        recruiterId = claims.id;
        jobId = str(body.job_id, 40);
        if (!candidateId) return fail('candidate_id is required.');
      } else {
        return fail('Access denied.', 403);
      }
      if (!candidateId || !recruiterId) return fail('Invalid conversation.');
      if (candidateId === recruiterId) return fail('Invalid conversation.');
    }

    // Reuse an existing thread rather than creating duplicates.
    const lookup =
      kind === 'admin_candidate'
        ? `conversations?kind=eq.admin_candidate&candidate_id=eq.${candidateId}&select=${CONV_SELECT}`
        : `conversations?kind=eq.recruiter_candidate&candidate_id=eq.${candidateId}&recruiter_id=eq.${recruiterId}&select=${CONV_SELECT}`;

    const existing = await rest(env, lookup);
    if (existing && existing.length) return json({ conversation: existing[0] });

    const created = await rest(env, 'conversations', {
      method: 'POST',
      prefer: 'return=representation',
      body: { kind, candidate_id: candidateId, recruiter_id: recruiterId, job_id: jobId }
    });
    return json({ conversation: created[0] }, 201);
  }

  const convMessagesMatch = path.match(/^\/api\/chat\/conversations\/(\d+)\/messages$/);
  if (convMessagesMatch && (method === 'GET' || method === 'POST')) {
    if (!claims) return fail('Authentication required.', 401);
    const conv = await loadConversation(env, convMessagesMatch[1]);
    if (!canAccess(conv, claims)) return fail('Conversation not found.', 404);

    if (method === 'GET') {
      const after = str(url.searchParams.get('after'), 30);
      let query = `messages?conversation_id=eq.${conv.id}&deleted_at=is.null&select=id,sender_id,sender_role,body,created_at,read_at&order=id.asc&limit=200`;
      if (after) query += `&id=gt.${encodeURIComponent(after)}`;
      const messages = (await rest(env, query)) || [];
      return json({ messages, conversation: conv });
    }

    const body = await request.json().catch(() => ({}));
    const text = str(body.body, 4000);
    if (!text) return fail('Message cannot be empty.');

    const inserted = await rest(env, 'messages', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        conversation_id: conv.id,
        sender_id: claims.id,
        sender_role: claims.role,
        body: text
      }
    });

    await rest(env, `conversations?id=eq.${conv.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { last_message_at: new Date().toISOString() }
    });

    const recipients = new Set();
    if (conv.kind === 'admin_candidate') {
      if (claims.role === 'candidate') {
        const admins = await rest(env, 'users?role=eq.admin&select=id');
        (admins || []).forEach((a) => recipients.add(a.id));
      } else if (conv.candidate_id) {
        recipients.add(conv.candidate_id);
      }
    } else {
      if (claims.id !== conv.candidate_id) recipients.add(conv.candidate_id);
      if (conv.recruiter_id && claims.id !== conv.recruiter_id) recipients.add(conv.recruiter_id);
    }

    const senderName =
      claims.role === 'admin' ? 'JobConnect team' : claims.role === 'recruiter' ? 'Recruiter' : 'Candidate';

    await Promise.all(
      [...recipients].map((userId) =>
        notify(env, userId, {
          type: 'new_message',
          title: `New message from ${senderName}`,
          body: text.slice(0, 140),
          conversation_id: conv.id
        })
      )
    );

    return json({ message: inserted[0] }, 201);
  }

  const convReadMatch = path.match(/^\/api\/chat\/conversations\/(\d+)\/read$/);
  if (convReadMatch && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    const conv = await loadConversation(env, convReadMatch[1]);
    if (!canAccess(conv, claims)) return fail('Conversation not found.', 404);

    await rest(env, `messages?conversation_id=eq.${conv.id}&read_at=is.null`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { read_at: new Date().toISOString() }
    });
    return json({ message: 'Marked as read.' });
  }

  /* ------------------------------------------------ admin moderation (APK) */

  const adminMessageMatch = path.match(/^\/api\/admin\/chat\/messages\/(\d+)$/);
  if (adminMessageMatch && method === 'DELETE') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);

    const rows = await rest(env, `messages?id=eq.${adminMessageMatch[1]}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { deleted_at: new Date().toISOString(), deleted_by: claims.id }
    });
    if (!rows || !rows.length) return fail('Message not found.', 404);
    return json({ message: 'Message deleted for both parties.' });
  }

  const adminConvMatch = path.match(/^\/api\/admin\/chat\/conversations\/(\d+)$/);
  if (adminConvMatch && method === 'DELETE') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);

    const rows = await rest(env, `conversations?id=eq.${adminConvMatch[1]}`, {
      method: 'DELETE',
      prefer: 'return=representation'
    });
    if (!rows || !rows.length) return fail('Conversation not found.', 404);
    return json({ message: 'Conversation deleted for both parties.' });
  }

  /* ------------------------------------------------------- notifications */

  if (path === '/api/notifications' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);

    const after = str(url.searchParams.get('after'), 30);
    let query =
      'notifications?user_id=eq.' +
      claims.id +
      '&select=id,type,title,body,conversation_id,application_ref,read_at,created_at&order=id.desc&limit=50';
    if (after) query += `&id=gt.${encodeURIComponent(after)}`;

    const notifications = (await rest(env, query)) || [];
    const unread = await rest(env, `notifications?user_id=eq.${claims.id}&read_at=is.null&select=id`);

    return json({
      notifications,
      unread_count: (unread || []).length,
      server_time: new Date().toISOString()
    });
  }

  if (path === '/api/notifications/read' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    const body = await request.json().catch(() => ({}));

    if (body.all !== false && !Array.isArray(body.ids)) {
      await rest(env, `notifications?user_id=eq.${claims.id}&read_at=is.null`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { read_at: new Date().toISOString() }
      });
      return json({ message: 'All notifications marked as read.' });
    }

    const ids = (body.ids || []).filter((id) => /^\d+$/.test(String(id)));
    if (ids.length) {
      await rest(env, `notifications?id=in.(${ids.join(',')})&user_id=eq.${claims.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { read_at: new Date().toISOString() }
      });
    }
    return json({ message: 'Notifications marked as read.' });
  }

  /* ------------------------------------------------------------- devices */

  if (path === '/api/devices' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    const body = await request.json().catch(() => ({}));
    const label = str(body.label, 80) || 'android';
    await rest(env, 'devices?on_conflict=user_id,label', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { user_id: claims.id, platform: 'android', label, last_seen_at: new Date().toISOString() }
    });
    return json({ message: 'Device registered.' });
  }

  return fail('Endpoint not found.', 404);
}

/* ------------------------------------------------------------ static files */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

function serveStatic(url) {
  const assets = typeof __ASSETS__ === 'object' ? __ASSETS__ : {};
  const pathname = decodeURIComponent(url.pathname);
  const key = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');

  const file = assets[key];
  if (file !== undefined) {
    const ext = extensionOf(key) || '.html';
    return new Response(file, {
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=3600'
      }
    });
  }

  // Single-page fallback.
  if (assets['index.html'] !== undefined && !/\.[a-z0-9]+$/i.test(key)) {
    return new Response(assets['index.html'], {
      headers: { 'content-type': MIME['.html'], 'cache-control': 'public, max-age=0, must-revalidate' }
    });
  }

  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, url, env);
      } catch (err) {
        console.error('API error:', err && err.stack ? err.stack : err);
        return fail(err && err.message ? err.message : 'Unexpected server error.', 500);
      }
    }

    return serveStatic(url);
  }
};
