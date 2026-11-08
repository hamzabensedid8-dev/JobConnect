
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

import {
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
} from './modules.js';
import { buildContractPdf, jpegSize } from './contract.js';

const ONE_DAY = 60 * 60 * 24;
const MAX_CV_BYTES = 5 * 1024 * 1024;
const ALLOWED_CV_EXT = ['.pdf', '.doc', '.docx'];
const JWT_TTL_SECONDS = 12 * 60 * 60;

const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'];
const JOB_STATUSES = ['pending', 'published', 'rejected', 'closed'];

const CONTRACT_TYPES = ['Permanent', 'Fixed-term', 'Temporary', 'Seasonal', 'Internship', 'Apprenticeship', 'Freelance'];

const EXPERIENCE_LEVELS = ['Entry level', 'Less than 2 years', '2–5 years', '5–10 years', 'More than 10 years'];

const JOB_CATEGORIES = [
  'Healthcare & Nursing', 'Information Technology', 'Engineering', 'Construction & Trades',
  'Skilled Trades & Manufacturing', 'Logistics & Transport', 'Hospitality & Tourism',
  'Food & Catering', 'Agriculture & Farming', 'Education & Training', 'Finance & Accounting',
  'Sales & Retail', 'Marketing & Communication', 'Customer Support', 'Administration & Office',
  'Legal', 'Human Resources', 'Social Work & Care', 'Pharmacy & Laboratory', 'Automotive',
  'Aviation', 'Maritime & Offshore', 'Energy & Utilities', 'Mining & Resources',
  'Oil & Gas', 'Textile & Garment', 'Beauty & Wellness', 'Sports & Fitness',
  'Security & Safety', 'Cleaning & Facility', 'Domestic & Household Work',
  'Childcare & Nanny', 'Elderly Care', 'Dentistry', 'Veterinary', 'Media & Creative',
  'Design & Architecture', 'Real Estate', 'Public Sector', 'Research & Science',
  'Telecommunications', 'Warehouse & Storage', 'Driving & Delivery'
];

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria',
  'Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan',
  'Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon',
  'Canada','Cape Verde','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica',
  'Croatia','Cuba','Cyprus','Czechia','Denmark','Djibouti','Dominica','Dominican Republic','DR Congo','Ecuador',
  'Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France',
  'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau',
  'Guyana','Haiti','Honduras','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq',
  'Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati',
  'Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein',
  'Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania',
  'Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
  'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Macedonia','Norway',
  'Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino',
  'Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands',
  'Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland',
  'Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia',
  'Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
  'Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'
];

const NATIONALITIES = [
  'Afghan','Albanian','Algerian','Andorran','Angolan','Antiguan','Argentine','Armenian','Australian','Austrian',
  'Azerbaijani','Bahamian','Bahraini','Bangladeshi','Barbadian','Belarusian','Belgian','Belizean','Beninese','Bhutanese',
  'Bolivian','Bosnian','Botswanan','Brazilian','Bruneian','Bulgarian','Burkinabe','Burundian','Cambodian','Cameroonian',
  'Canadian','Cape Verdean','Central African','Chadian','Chilean','Chinese','Colombian','Comorian','Congolese','Costa Rican',
  'Croatian','Cuban','Cypriot','Czech','Danish','Djiboutian','Dominican','Dutch','Ecuadorian','Egyptian',
  'Emirati','English','Equatorial Guinean','Eritrean','Estonian','Eswatini','Ethiopian','Fijian','Filipino','Finnish',
  'French','Gabonese','Gambian','Georgian','German','Ghanaian','Greek','Grenadian','Guatemalan','Guinean',
  'Guyanese','Haitian','Honduran','Hungarian','Icelandic','Indian','Indonesian','Iranian','Iraqi','Irish',
  'Israeli','Italian','Ivorian','Jamaican','Japanese','Jordanian','Kazakh','Kenyan','Kittitian','Kuwaiti',
  'Kyrgyz','Laotian','Latvian','Lebanese','Liberian','Libyan','Liechtenstein','Lithuanian','Luxembourgish','Macedonian',
  'Malagasy','Malawian','Malaysian','Maldivian','Malian','Maltese','Mauritanian','Mauritian','Mexican','Moldovan',
  'Monacan','Mongolian','Montenegrin','Moroccan','Mozambican','Namibian','Nepalese','New Zealander','Nicaraguan','Nigerien',
  'Nigerian','North Korean','Norwegian','Omani','Pakistani','Palauan','Palestinian','Panamanian','Papua New Guinean','Paraguayan',
  'Peruvian','Polish','Portuguese','Qatari','Romanian','Russian','Rwandan','Samoan','Saudi','Scottish',
  'Senegalese','Serbian','Seychellois','Sierra Leonean','Singaporean','Slovak','Slovenian','Somali','South African','South Korean',
  'Spanish','Sri Lankan','Sudanese','Surinamese','Swedish','Swiss','Syrian','Taiwanese','Tajik','Tanzanian',
  'Thai','Togolese','Tongan','Trinidadian','Tunisian','Turkish','Turkmen','Tuvaluan','Ugandan','Ukrainian',
  'Uruguayan','Uzbek','Vanuatuan','Venezuelan','Vietnamese','Welsh','Yemeni','Zambian','Zimbabwean'
];

const PLANS = {
  recruiter_pro: {
    role: 'recruiter',
    amount_cents: 9500,
    currency: 'USD',
    name: 'Recruiter Pro',
    interval: 'month',
    promotional: false,
    features: [
      'Publish unlimited contracts',
      'Candidate database access',
      'Priority moderation',
      'Receipts and invoices included'
    ]
  },
  recruiter_promo: {
    role: 'recruiter',
    amount_cents: 4900,
    currency: 'USD',
    name: 'Recruiter Promo',
    interval: 'month',
    promotional: true,
    features: [
      'Promotional rate, limited period',
      'Publish up to 5 contracts per month',
      'Standard moderation',
      'Receipts and invoices included'
    ]
  },
  // Le candidat ne paie aucun abonnement : quand un contrat est payant, le
  // montant est réglé une seule fois, dans le contrat lui-même.
  candidate_free: {
    role: 'candidate',
    amount_cents: 0,
    currency: 'USD',
    name: 'Candidate (free)',
    interval: null,
    promotional: false,
    features: ['Free account', 'Unlimited contract requests', 'Track every request']
  }
};

const PREMIUM_PLANS = PLANS;

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

/* ------------------------------------------------------- settings & SLA */

let SETTINGS_TTL = { at: 0, value: null };

async function getSettings(env) {
  const now = Date.now();
  if (SETTINGS_TTL.value && now - SETTINGS_TTL.at < 30000) return SETTINGS_TTL.value;
  const value = await loadSettings(env, rest);
  SETTINGS_TTL = { at: now, value };
  return value;
}

function priceBreakdown(job, settings) {
  const fee = Number(settings.jobconnect_fee_cents || 0);
  const recruiterPrice = job && job.recruiter_price_cents != null
    ? Number(job.recruiter_price_cents)
    : Number(settings.default_recruiter_price_cents || 0);
  return {
    fee_cents: fee,
    recruiter_price_cents: recruiterPrice,
    total_cents: fee + recruiterPrice,
    currency: (job && job.currency) || settings.currency || 'USD'
  };
}

/** Un recruteur doit avoir un abonnement actif pour publier. */
async function activeSubscription(env, userId) {
  const nowIso = new Date().toISOString();
  const rows = await rest(
    env,
    `subscriptions?user_id=eq.${userId}&status=eq.active&select=id,plan,status,current_period_end,created_at&order=created_at.desc&limit=1`
  );
  const sub = (rows || [])[0];
  if (!sub) return null;
  if (sub.current_period_end && sub.current_period_end < nowIso) return null;
  return sub;
}

async function audit(env, actorId, action, target, detail) {
  try {
    await rest(env, 'audit_log', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { actor_id: actorId, action, target, detail: detail || null }
    });
  } catch (err) {
    console.error('audit failed:', err && err.message ? err.message : err);
  }
}

function publicApplication(a, settings) {
  return {
    reference: a.reference,
    full_name: a.full_name,
    profession: a.profession,
    category: a.category,
    target_country: a.target_country,
    contract_type: a.contract_type,
    status: a.status,
    decision_reason: a.decision_reason || null,
    admin_note: a.decision_reason || a.admin_note || null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    decided_at: a.decided_at || null,
    response_due_at: a.response_due_at || null,
    fee_cents: a.fee_cents,
    recruiter_price_cents: a.recruiter_price_cents,
    total_cents: a.total_cents,
    currency: a.currency || (settings && settings.currency) || 'USD',
    paid_at: a.paid_at || null,
    job_id: a.job_id || null
  };
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
    const clientKey = request.headers.get('x-jc-client-key') || '';

    // La console admin (APK) se connecte par mot de passe uniquement : le compte
    // administrateur est identifié par la clé client de l'application.
    const passwordOnlyAdmin =
      !email && clientKey && env.ADMIN_CLIENT_KEY && clientKey === env.ADMIN_CLIENT_KEY;

    let user = null;
    if (passwordOnlyAdmin) {
      const admins = await rest(env, 'users?role=eq.admin&select=*&limit=5');
      const candidates = admins || [];
      for (const candidate of candidates) {
        const match = await rpc(env, 'jc_verify_password', {
          pw: password,
          hashed: candidate.password_hash
        });
        if (match) { user = candidate; break; }
      }
      if (!user) return fail('Incorrect password.', 401);
    } else {
      const rows = await rest(env, `users?email=eq.${encodeURIComponent(email || '')}&select=*`);
      user = rows && rows[0];
    }

    // Always run the comparison so timing does not leak account existence.
    if (!passwordOnlyAdmin) {
      const ok = await rpc(env, 'jc_verify_password', {
        pw: password,
        hashed: (user && user.password_hash) || '$2a$11$0000000000000000000000000000000000000000000000000000'
      });
      if (!user || !ok) {
        return fail('Incorrect email or password.', 401);
      }
    }

    // The admin console only exists inside the Android application. An admin
    // account cannot obtain a session from the website: the official client
    // sends the shared client key, the browser never does.
    if (user.role === 'admin') {
      const provided = clientKey;
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

  if (path === '/api/catalog' && method === 'GET') {
    return json({
      categories: JOB_CATEGORIES,
      contract_types: CONTRACT_TYPES,
      countries: COUNTRIES,
      nationalities: NATIONALITIES,
      experience_levels: EXPERIENCE_LEVELS
    });
  }

  if (path === '/api/plans' && method === 'GET') {
    return json({ plans: PREMIUM_PLANS, payment_enabled: false });
  }

  if (path === '/api/subscriptions' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role === 'admin') return fail('Access denied.', 403);

    // Les candidats sont gratuits : rien à souscrire.
    if (claims.role === 'candidate') {
      return json({
        status: 'free',
        message: 'Candidate accounts are free. No subscription or payment is required to apply.'
      });
    }

    return fail(
      'Recruiter plans require a card payment. Use POST /api/subscriptions/checkout to start the Stripe Checkout session.',
      402
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
    const category = str(url.searchParams.get('category'), 120);

    if (country) params.append('country', `ilike.*${country}*`);
    if (type) params.append('contract_type', `eq.${type}`);
    if (category) params.append('category', `eq.${category}`);
    if (term) {
      const safe = term.replace(/[,()*]/g, '');
      params.append('or', `(title.ilike.*${safe}*,company.ilike.*${safe}*,description.ilike.*${safe}*,category.ilike.*${safe}*)`);
    }

    const jobs = await rest(env, `jobs?${params.toString()}`);
    const settings = await getSettings(env);
    return json({
      jobs: (jobs || []).map((j) => {
        const p = priceBreakdown(j, settings);
        return { ...j, pricing: p };
      }),
      pricing_defaults: {
        fee_cents: Number(settings.jobconnect_fee_cents),
        recruiter_price_cents: Number(settings.default_recruiter_price_cents),
        currency: settings.currency
      }
    });
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

    // Les recruteurs doivent être abonnés (95 USD/mois ou formule promo) pour publier.
    if (claims.role === 'recruiter') {
      const sub = await activeSubscription(env, claims.id);
      if (!sub) {
        return fail(
          'An active recruiter subscription is required to publish contracts. ' +
            'Subscribe to Recruiter Pro (95 USD/month) or the promotional plan first.',
          402
        );
      }
    }

    const settings = await getSettings(env);
    const recruiterPrice = body.recruiter_price_cents != null
      ? Math.max(0, Math.min(10000000, Math.round(Number(body.recruiter_price_cents))))
      : Number(settings.default_recruiter_price_cents || 15000);

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
        recruiter_price_cents: recruiterPrice,
        currency: str(body.currency, 8) || settings.currency || 'USD',
        visa_sponsorship: Boolean(body.visa_sponsorship),
        duration_months: body.duration_months ? Number(body.duration_months) : null,
        positions: body.positions ? Math.max(1, Number(body.positions)) : 1,
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

    const settings = await getSettings(env);
    const pricing = priceBreakdown(job, settings);
    const reference = randomReference();
    const dueAt = new Date(Date.now() + Number(settings.sla_target_max_minutes || 20) * 60000).toISOString();

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
        category: job.category,
        contract_type: job.contract_type,
        message: `Application for job #${job.id}`,
        cv_path: cvPath,
        status: 'pending',
        response_due_at: dueAt,
        fee_cents: pricing.fee_cents,
        recruiter_price_cents: pricing.recruiter_price_cents,
        total_cents: pricing.total_cents,
        currency: pricing.currency
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

    const settings = await getSettings(env);
    const directPricing = {
      fee_cents: Number(settings.jobconnect_fee_cents || 0),
      recruiter_price_cents: 0,
      total_cents: Number(settings.jobconnect_fee_cents || 0),
      currency: settings.currency || 'USD'
    };
    const directDueAt = new Date(Date.now() + Number(settings.sla_target_max_minutes || 20) * 60000).toISOString();

    await rest(env, 'applications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        reference,
        candidate_id: candidateId,
        status: 'pending',
        response_due_at: directDueAt,
        fee_cents: directPricing.fee_cents,
        recruiter_price_cents: directPricing.recruiter_price_cents,
        total_cents: directPricing.total_cents,
        currency: directPricing.currency,
        full_name: fullName,
        email,
        phone: str(fields.phone, 60),
        nationality: str(fields.nationality, 120),
        residence_country: str(fields.residence_country, 120),
        target_country: targetCountry,
        profession,
        contract_type: contractType,
        experience: str(fields.experience, 60),
        category: str(fields.category, 120),
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
    const fields = '*';
    const rows = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}&select=${fields}`);
    if (!rows || !rows.length) return fail('No request found for this code.', 404);
    const settings = await getSettings(env);
    return json({
      application: { ...publicApplication(rows[0], settings), sla: slaState(rows[0], settings) }
    });
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
    const settings = await getSettings(env);
    const overviewCreds = await loadStripeCredentials(env, rest, { force: true });
    const [users, applications, jobs, subscriptions, latestApplications, latestJobs, payments, activeSubs] = await Promise.all([
      rest(env, 'users?select=role'),
      rest(env, 'applications?select=status'),
      rest(env, 'jobs?select=status'),
      rest(env, 'subscriptions?select=status'),
      rest(
        env,
        'applications?select=reference,full_name,email,profession,target_country,status,created_at&order=created_at.desc&limit=30'
      ),
      rest(env, 'jobs?select=id,title,company,country,status,created_at&order=created_at.desc&limit=30'),
      rest(env, 'payments?select=status,total_cents,fee_cents,recruiter_price_cents,currency,paid_at,created_at'),
      rest(env, 'subscriptions?status=eq.active&select=id,plan,amount_cents,current_period_end')
    ]);

    const paid = (payments || []).filter((p) => p.status === 'paid');
    const revenueFees = paid.reduce((sum, p) => sum + Number(p.fee_cents || 0), 0);
    const revenueRecruiter = paid.reduce((sum, p) => sum + Number(p.recruiter_price_cents || 0), 0);
    const pending = (latestApplications || []).filter((a) => a.status === 'pending');
    const overdue = pending.filter((a) => slaState(a, settings).overdue);
    const responded = (latestApplications || []).filter((a) => a.first_response_at);
    const avgMinutes = responded.length
      ? Math.round(
          responded.reduce(
            (sum, a) =>
              sum +
              (new Date(a.first_response_at).getTime() - new Date(a.created_at).getTime()) / 60000,
            0
          ) / responded.length
        )
      : null;

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
      latestApplications: (latestApplications || []).map((a) => ({
        ...a,
        sla: slaState(a, settings)
      })),
      latestJobs: latestJobs || [],
      revenue: {
        currency: settings.currency,
        payments_count: paid.length,
        jobconnect_fees_cents: revenueFees,
        recruiter_prices_cents: revenueRecruiter,
        total_cents: revenueFees + revenueRecruiter
      },
      sla: {
        target_min_minutes: Number(settings.sla_target_min_minutes),
        target_max_minutes: Number(settings.sla_target_max_minutes),
        pending_count: pending.length,
        overdue_count: overdue.length,
        average_response_minutes: avgMinutes
      },
      active_subscriptions: (activeSubs || []).length,
      integrations: { payments: Boolean(overviewCreds.secret), email: mailConfigured(env) }
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
    if (!APPLICATION_STATUSES.includes(body.status)) {
      return fail('Invalid status. Use pending, accepted or rejected.');
    }
    const reference = decodeURIComponent(adminAppMatch[1]).toUpperCase();

    // Rejet : le motif est obligatoire et doit être explicite.
    const reason = str(body.decision_reason ?? body.admin_note, 2000);
    if (body.status === 'rejected' && (!reason || reason.trim().length < 5)) {
      return fail('A rejection reason of at least 5 characters is required.', 422);
    }

    const existing = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}&select=*`);
    const current = existing && existing[0];
    if (!current) return fail('Request not found.', 404);

    const nowIso = new Date().toISOString();
    const patch = {
      status: body.status,
      decision_reason: body.status === 'pending' ? null : reason || null,
      updated_at: nowIso,
      first_response_at: current.first_response_at || nowIso
    };
    if (body.status !== 'pending') {
      patch.decided_at = nowIso;
      patch.decided_by = claims.id;
    }

    const rows = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: patch
    });
    if (!rows || !rows.length) return fail('Request not found.', 404);

    const settings = await getSettings(env);
    const updated = rows[0];

    // Le candidat est prévenu par e-mail (réel) si l'infrastructure est configurée.
    await sendEmail(env, rest, {
      to: updated.email,
      userId: updated.candidate_id,
      template: `decision_${updated.status}`,
      subject: updated.status === 'accepted'
        ? `Your JobConnect request ${reference} has been accepted`
        : `Your JobConnect request ${reference} has been reviewed`,
      html: emailLayout(
        updated.status === 'accepted' ? 'Good news, your request was accepted' : 'Update on your request',
        `<p>Hello ${updated.full_name},</p>
         <p>Your request <b>${reference}</b> (${updated.profession} → ${updated.target_country}) is now
         <b>${updated.status.toUpperCase()}</b>.</p>
         ${reason ? `<p style="background:#f4f7ff;padding:12px;border-radius:8px"><b>Message:</b> ${reason}</p>` : ''}
         <p>Reference: <b>${reference}</b></p>`,
        'JobConnect does not guarantee a visa, an offer or employment.'
      )
    });

    await audit(env, claims.id, `application_${updated.status}`, reference, {
      reason: reason || null,
      sla: slaState(updated, settings)
    });

    return json({
      message: 'Request updated.',
      application: publicApplication(updated, settings),
      sla: slaState(updated, settings),
      email: mailConfigured(env) ? 'sent' : 'not_configured'
    });
  }

  /* ------------------------------------------------ décision recruteur */

  const recruiterDecision = path.match(/^\/api\/recruiter\/applications\/(.+)\/decision$/);
  if (recruiterDecision && method === 'PATCH') {
    if (!claims) return fail('Authentication required.', 401);
    if (!['recruiter', 'admin'].includes(claims.role)) return fail('Access denied.', 403);

    const body = await request.json().catch(() => ({}));
    if (!['accepted', 'rejected'].includes(body.status)) {
      return fail('Status must be accepted or rejected.');
    }
    const reason = str(body.decision_reason, 2000);
    if (body.status === 'rejected' && (!reason || reason.trim().length < 5)) {
      return fail('A rejection reason of at least 5 characters is required.', 422);
    }

    const reference = decodeURIComponent(recruiterDecision[1]).toUpperCase();
    const rows = await rest(
      env,
      `applications?reference=eq.${encodeURIComponent(reference)}&select=*,jobs(recruiter_id)`
    );
    const app = rows && rows[0];
    if (!app) return fail('Request not found.', 404);
    if (claims.role === 'recruiter' && (!app.jobs || app.jobs.recruiter_id !== claims.id)) {
      return fail('Access denied.', 403);
    }
    if (!app.paid_at) {
      return fail('The candidate has not completed the payment yet.', 402);
    }

    const nowIso = new Date().toISOString();
    const updatedRows = await rest(env, `applications?reference=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: body.status,
        decision_reason: reason || null,
        first_response_at: app.first_response_at || nowIso,
        decided_at: nowIso,
        decided_by: claims.id,
        updated_at: nowIso
      }
    });

    const settings = await getSettings(env);
    await audit(env, claims.id, `recruiter_${body.status}`, reference, { reason: reason || null });
    return json({
      message: 'Decision recorded.',
      application: publicApplication(updatedRows[0], settings),
      sla: slaState(updatedRows[0], settings)
    });
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
    let kind;
    if (body.kind === 'recruiter') kind = 'recruiter_candidate';
    else if (body.kind === 'admin') kind = claims.role === 'recruiter' ? 'admin_recruiter' : 'admin_candidate';
    else kind = claims.role === 'recruiter' ? 'admin_recruiter' : 'admin_candidate';

    let candidateId = null;
    let recruiterId = null;
    let jobId = null;

    if (kind === 'admin_candidate' || kind === 'admin_recruiter') {
      const isRecruiterThread = kind === 'admin_recruiter';
      const me = isRecruiterThread ? claims.role === 'recruiter' : claims.role === 'candidate';
      const other = isRecruiterThread ? str(body.recruiter_id, 60) : str(body.candidate_id, 60);

      if (me) {
        if (isRecruiterThread) recruiterId = claims.id;
        else candidateId = claims.id;
      } else if (claims.role === 'admin') {
        if (isRecruiterThread) recruiterId = other;
        else candidateId = other;
        if (!other) return fail(isRecruiterThread ? 'recruiter_id is required.' : 'candidate_id is required.');
      } else {
        return fail('Access denied.', 403);
      }
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
    let lookup;
    if (kind === 'admin_candidate') {
      lookup = `conversations?kind=eq.admin_candidate&candidate_id=eq.${candidateId}&select=${CONV_SELECT}`;
    } else if (kind === 'admin_recruiter') {
      lookup = `conversations?kind=eq.admin_recruiter&recruiter_id=eq.${recruiterId}&select=${CONV_SELECT}`;
    } else {
      lookup = `conversations?kind=eq.recruiter_candidate&candidate_id=eq.${candidateId}&recruiter_id=eq.${recruiterId}&select=${CONV_SELECT}`;
    }

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
    if (conv.kind === 'admin_candidate' || conv.kind === 'admin_recruiter') {
      const peerId = conv.kind === 'admin_candidate' ? conv.candidate_id : conv.recruiter_id;
      if (claims.role === 'admin') {
        if (peerId) recipients.add(peerId);
      } else {
        const admins = await rest(env, 'users?role=eq.admin&select=id');
        (admins || []).forEach((a) => recipients.add(a.id));
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


  /* ------------------------------------------------------- paiements */

  if (path === '/api/payments/checkout' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    const body = await request.json().catch(() => ({}));
    const reference = str(body.reference, 40);
    if (!reference) return fail('reference is required.');

    const rows = await rest(
      env,
      `applications?reference=eq.${encodeURIComponent(reference.toUpperCase())}&select=*`
    );
    const app = rows && rows[0];
    if (!app) return fail('Request not found.', 404);
    if (app.candidate_id && app.candidate_id !== claims.id && claims.role !== 'admin') {
      return fail('Access denied.', 403);
    }
    if (app.paid_at) return fail('This request is already paid.', 409);

    const creds = await loadStripeCredentials(env, rest, { force: true });
    if (!creds.secret) {
      return fail(
        'Card payments are not configured yet. An administrator must add the receiving ' +
          'account in the admin console (Settings → Receiving account).',
        503
      );
    }

    const settings = await getSettings(env);
    const fee = Number(app.fee_cents != null ? app.fee_cents : settings.jobconnect_fee_cents);
    const recruiterPrice = Number(app.recruiter_price_cents || 0);
    const total = Number(app.total_cents != null ? app.total_cents : fee + recruiterPrice);
    const currency = (app.currency || settings.currency || 'USD').toLowerCase();

    const paymentRef = `JC-PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await rest(env, 'payments', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        reference: paymentRef,
        application_id: app.id,
        payer_id: claims.id,
        kind: 'application',
        fee_cents: fee,
        recruiter_price_cents: recruiterPrice,
        total_cents: total,
        currency: currency.toUpperCase(),
        status: 'pending'
      }
    });

    const origin = env.PUBLIC_URL || new URL(request.url).origin;
    const session = await stripeRequest(env, 'checkout/sessions', {
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': total,
      'line_items[0][price_data][product_data][name]': `JobConnect request ${app.reference}`,
      'line_items[0][price_data][product_data][description]':
        `JobConnect fee ${money(fee, currency.toUpperCase())} + recruiter price ${money(recruiterPrice, currency.toUpperCase())}`,
      customer_email: app.email,
      client_reference_id: app.reference,
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel?reference=${encodeURIComponent(app.reference)}`,
      'metadata[application_reference]': app.reference,
      'metadata[payment_reference]': paymentRef
    }, rest);

    await rest(env, `payments?id=eq.${inserted[0].id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { provider_session_id: session.id }
    });

    return json({
      payment_reference: paymentRef,
      checkout_url: session.url,
      total_cents: total,
      fee_cents: fee,
      recruiter_price_cents: recruiterPrice,
      currency: currency.toUpperCase()
    }, 201);
  }

  if (path === '/api/payments/session' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const sessionId = str(url.searchParams.get('session_id'), 200);
    if (!sessionId) return fail('session_id is required.');
    const rows = await rest(env, `payments?provider_session_id=eq.${encodeURIComponent(sessionId)}&select=*`);
    const payment = rows && rows[0];
    if (!payment) return fail('Payment not found.', 404);
    if (claims.role !== 'admin' && payment.payer_id !== claims.id) return fail('Access denied.', 403);

    const apps = payment.application_id
      ? await rest(env, `applications?id=eq.${payment.application_id}&select=reference,status,profession,target_country`)
      : [];
    return json({
      payment: {
        reference: payment.reference,
        status: payment.status,
        total_cents: payment.total_cents,
        fee_cents: payment.fee_cents,
        recruiter_price_cents: payment.recruiter_price_cents,
        currency: payment.currency,
        receipt_number: payment.receipt_number
      },
      application: (apps || [])[0] || null
    });
  }

  if (path === '/api/payments/by-reference' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const ref = str(url.searchParams.get('reference'), 40).toUpperCase();
    if (!ref) return fail('reference is required.');
    const rows = await rest(env, `payments?reference=eq.${encodeURIComponent(ref)}&select=*&order=created_at.desc`);
    const payment = rows && rows[0];
    if (!payment) return fail('Payment not found.', 404);
    if (claims.role !== 'admin' && payment.payer_id !== claims.id) return fail('Access denied.', 403);

    const apps = payment.application_id
      ? await rest(env, `applications?id=eq.${payment.application_id}&select=reference,status,profession,target_country`)
      : [];
    return json({
      payment: {
        reference: payment.reference,
        status: payment.status,
        total_cents: payment.total_cents,
        fee_cents: payment.fee_cents,
        recruiter_price_cents: payment.recruiter_price_cents,
        currency: payment.currency,
        receipt_number: payment.receipt_number
      },
      application: (apps || [])[0] || null
    });
  }

  if (path === '/api/payments/mine' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const rows = await rest(
      env,
      `payments?payer_id=eq.${claims.id}&select=reference,kind,fee_cents,recruiter_price_cents,total_cents,currency,status,paid_at,receipt_number,created_at&order=created_at.desc`
    );
    return json({ payments: rows || [] });
  }

  const receiptMatch = path.match(/^\/api\/payments\/(.+)\/receipt\.pdf$/);
  if (receiptMatch && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    const ref = decodeURIComponent(receiptMatch[1]).toUpperCase();
    const rows = await rest(env, `payments?reference=eq.${encodeURIComponent(ref)}&select=*`);
    const payment = rows && rows[0];
    if (!payment) return fail('Payment not found.', 404);
    if (claims.role !== 'admin' && payment.payer_id !== claims.id) {
      return fail('Access denied.', 403);
    }
    if (payment.status !== 'paid') return fail('This payment is not completed yet.', 409);

    const payers = await rest(env, `users?id=eq.${payment.payer_id}&select=name,email`);
    const payer = (payers && payers[0]) || {};

    const pdf = buildReceiptPdf({
      receiptNumber: payment.receipt_number || payment.reference,
      date: new Date(payment.paid_at || payment.created_at).toISOString().slice(0, 10),
      payerName: payer.name,
      payerEmail: payer.email,
      currency: payment.currency,
      total: payment.total_cents,
      lines: [
        { label: 'JobConnect fee', amount_cents: payment.fee_cents },
        { label: 'Recruiter price', amount_cents: payment.recruiter_price_cents }
      ]
    });

    return new Response(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="receipt-${payment.reference}.pdf"`,
        'cache-control': 'private, no-store'
      }
    });
  }


  /* ------------------------------------------- compte encaisseur (admin) */

  if (path === '/api/admin/payments/account' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);

    const creds = await loadStripeCredentials(env, rest, { force: true });
    const rows = await rest(
      env,
      'integration_credentials?select=key,hint,updated_at&order=updated_at.desc'
    );
    const hints = {};
    for (const row of rows || []) hints[row.key] = row;

    const secretHint = hints.stripe_secret_key || null;
    const pubHint = hints.stripe_publishable_key || null;

    return json({
      configured: Boolean(creds.secret),
      source: creds.source,
      publishable_key: creds.publishable
        ? creds.publishable.slice(0, 12) + '…' + creds.publishable.slice(-4)
        : null,
      secret_key: creds.secret ? creds.secret.slice(0, 7) + '…' + creds.secret.slice(-4) : null,
      webhook_configured: Boolean(creds.webhook),
      webhook_secret: creds.webhook ? 'whsec_…' + creds.webhook.slice(-4) : null,
      updated_at: secretHint ? secretHint.updated_at : null,
      hint: secretHint ? secretHint.hint : null
    });
  }

  if (path === '/api/admin/payments/account' && method === 'PUT') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    if (!env.CREDENTIAL_KEY) {
      return fail('CREDENTIAL_KEY is not configured on the server; credentials cannot be stored.', 503);
    }

    const body = await request.json().catch(() => ({}));
    const secretKey = str(body.secret_key, 200);
    const publishableKey = str(body.publishable_key, 200);
    const webhookSecret = str(body.webhook_secret, 200);
    const label = str(body.label, 120) || 'Stripe account';

    if (!secretKey && !publishableKey && !webhookSecret) return fail('secret_key is required.');
    if (webhookSecret && !/^whsec_[A-Za-z0-9]+/.test(webhookSecret)) {
      return fail('That does not look like a Stripe webhook secret (whsec_…).');
    }
    if (secretKey && !/^sk_(live|test)_[A-Za-z0-9]+/.test(secretKey)) {
      return fail('That does not look like a Stripe secret key (sk_live_… or sk_test_…).');
    }
    if (publishableKey && !/^pk_(live|test)_[A-Za-z0-9]+/.test(publishableKey)) {
      return fail('That does not look like a Stripe publishable key (pk_live_… or pk_test_…).');
    }

    // Vérification réelle auprès de Stripe avant d'enregistrer quoi que ce soit.
    let account = null;
    if (secretKey) {
      try {
        const res = await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secretKey}` }
        });
        const data = await res.json();
        if (!res.ok) {
          return fail(`Stripe refused this key: ${(data.error && data.error.message) || res.status}`, 400);
        }
        account = {
          available: (data.available || []).map((b) => ({ amount: b.amount, currency: b.currency })),
          livemode: Boolean(data.livemode)
        };
      } catch (err) {
        return fail('Could not reach Stripe to verify this key.', 502);
      }
    }

    if (secretKey) {
      await rest(env, 'rpc/jc_set_credential', {
        method: 'POST',
        body: {
          p_key: 'stripe_secret_key',
          p_value: secretKey,
          p_passphrase: env.CREDENTIAL_KEY,
          p_hint: label,
          p_actor: claims.id
        }
      });
    }
    if (publishableKey) {
      await rest(env, 'rpc/jc_set_credential', {
        method: 'POST',
        body: {
          p_key: 'stripe_publishable_key',
          p_value: publishableKey,
          p_passphrase: env.CREDENTIAL_KEY,
          p_hint: label,
          p_actor: claims.id
        }
      });
    }
    if (webhookSecret) {
      await rest(env, 'rpc/jc_set_credential', {
        method: 'POST',
        body: {
          p_key: 'stripe_webhook_secret',
          p_value: webhookSecret,
          p_passphrase: env.CREDENTIAL_KEY,
          p_hint: label,
          p_actor: claims.id
        }
      });
    }

    await rest(env, 'payout_accounts', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        label,
        provider: 'stripe',
        account_id: account ? (account.livemode ? 'live' : 'test') : null,
        currency: account && account.available[0] ? account.available[0].currency : null
      }
    });

    resetStripeCredentials();
    await audit(env, claims.id, 'payout_account_changed', label, {
      livemode: account ? account.livemode : null
    });

    return json({
      message: 'Receiving account updated. New payments are sent to this account.',
      account
    });
  }

  if (path === '/api/admin/payments/account' && method === 'DELETE') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    await rest(env, 'rpc/jc_delete_credential', { method: 'POST', body: { p_key: 'stripe_secret_key' } });
    await rest(env, 'rpc/jc_delete_credential', { method: 'POST', body: { p_key: 'stripe_publishable_key' } });
    await rest(env, 'rpc/jc_delete_credential', { method: 'POST', body: { p_key: 'stripe_webhook_secret' } });
    resetStripeCredentials();
    await audit(env, claims.id, 'payout_account_removed', 'stripe', null);
    return json({ message: 'Receiving account removed. Card payments are disabled.' });
  }

  /* ------------------------------------- formulaire carte (PaymentIntent) */

  if (path === '/api/payments/intent' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    const body = await request.json().catch(() => ({}));
    const reference = str(body.reference, 40);
    if (!reference) return fail('reference is required.');

    const rows = await rest(
      env,
      `applications?reference=eq.${encodeURIComponent(reference.toUpperCase())}&select=*`
    );
    const app = rows && rows[0];
    if (!app) return fail('Request not found.', 404);
    if (app.candidate_id && app.candidate_id !== claims.id && claims.role !== 'admin') {
      return fail('Access denied.', 403);
    }
    if (app.paid_at) return fail('This request is already paid.', 409);

    const creds = await loadStripeCredentials(env, rest, { force: true });
    if (!creds.secret) {
      return fail('Card payments are not configured yet. An administrator must add the receiving account.', 503);
    }

    const settings = await getSettings(env);
    const fee = Number(app.fee_cents != null ? app.fee_cents : settings.jobconnect_fee_cents);
    const recruiterPrice = Number(app.recruiter_price_cents || 0);
    const total = Number(app.total_cents != null ? app.total_cents : fee + recruiterPrice);
    const currency = (app.currency || settings.currency || 'USD').toLowerCase();

    const paymentRef = `JC-PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await rest(env, 'payments', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        reference: paymentRef,
        application_id: app.id,
        payer_id: claims.id,
        kind: 'application',
        fee_cents: fee,
        recruiter_price_cents: recruiterPrice,
        total_cents: total,
        currency: currency.toUpperCase(),
        status: 'pending'
      }
    });

    const intent = await stripeRequest(env, 'payment_intents', {
      amount: total,
      currency,
      'automatic_payment_methods[enabled]': 'true',
      'metadata[application_reference]': app.reference,
      'metadata[payment_reference]': paymentRef,
      receipt_email: app.email
    }, rest);

    await rest(env, `payments?id=eq.${inserted[0].id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { provider_payment_intent: intent.id }
    });

    return json({
      payment_reference: paymentRef,
      client_secret: intent.client_secret,
      publishable_key: creds.publishable || null,
      total_cents: total,
      fee_cents: fee,
      recruiter_price_cents: recruiterPrice,
      currency: currency.toUpperCase()
    }, 201);
  }


  /* ---------------------------------------------------- contrats (admin) */

  if (path === '/api/admin/contracts' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    const rows = await rest(
      env,
      'contracts?select=id,contract_number,employee_name,employer_name,position,country,is_free,total_cents,currency,status,created_at,application_id&order=created_at.desc&limit=200'
    );
    return json({ contracts: rows || [] });
  }

  if (path === '/api/admin/contracts' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);

    const body = await request.json().catch(() => ({}));
    const employeeName = str(body.employee_name, 160);
    const employerName = str(body.employer_name, 160);
    const position = str(body.position, 160);
    if (!employeeName || !employerName || !position) {
      return fail('Employee name, employer name and position are required.');
    }

    const numbers = await rest(env, 'rpc/jc_next_contract_number', { method: 'POST', body: {} });
    const contractNumber = typeof numbers === 'string' ? numbers : (numbers && numbers[0]) || null;
    if (!contractNumber) return fail('Could not allocate a contract number.', 500);

    const toInt = (value, def = 0) => {
      if (value === '' || value == null) return def;
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? Math.max(0, n) : def;
    };
    const dateOrNull = (value) => {
      const text = str(value, 20);
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    };

    const fee = toInt(body.fee_cents, 0);
    const recruiterPrice = toInt(body.recruiter_price_cents, 0);
    const isFree = Boolean(body.is_free);
    const total = isFree ? 0 : fee + recruiterPrice;

    // Rattachement éventuel à une demande existante (référence JC-...).
    let applicationId = null;
    const applicationReference = (str(body.application_reference, 40) || '').toUpperCase();
    if (applicationReference) {
      const apps = await rest(
        env,
        `applications?reference=eq.${encodeURIComponent(applicationReference)}&select=id,reference`
      );
      if (apps && apps[0]) applicationId = apps[0].id;
      else return fail('No request found with this reference.', 404);
    }

    const payload = {
      contract_number: contractNumber,
      application_id: applicationId,
      created_by: claims.id,
      employer_name: employerName,
      employer_address: str(body.employer_address, 400),
      employer_contact: str(body.employer_contact, 200),
      employee_name: employeeName,
      employee_address: str(body.employee_address, 400),
      employee_passport: str(body.employee_passport, 60),
      employee_nationality: str(body.employee_nationality, 120),
      employee_contact: str(body.employee_contact, 200),
      employee_birth_date: dateOrNull(body.employee_birth_date),
      position,
      contract_type: str(body.contract_type, 60) || 'Permanent',
      country: str(body.country, 120),
      city: str(body.city, 120),
      duration_months: body.duration_months ? toInt(body.duration_months) : null,
      start_date: dateOrNull(body.start_date),
      end_date: dateOrNull(body.end_date),
      weekly_hours: body.weekly_hours ? toInt(body.weekly_hours) : null,
      trial_period: str(body.trial_period, 120),
      salary: str(body.salary, 160),
      salary_period: str(body.salary_period, 60),
      benefits: str(body.benefits, 800),
      housing: str(body.housing, 400),
      transport: str(body.transport, 400),
      is_free: isFree,
      fee_cents: fee,
      recruiter_price_cents: recruiterPrice,
      total_cents: total,
      currency: str(body.currency, 8) || 'USD',
      payment_reference: str(body.payment_reference, 60),
      additional_clauses: str(body.additional_clauses, 8000),
      signing_place: str(body.signing_place, 160),
      signing_date: dateOrNull(body.signing_date),
      status: 'issued'
    };

    const inserted = await rest(env, 'contracts', {
      method: 'POST',
      prefer: 'return=representation',
      body: payload
    });

    if (applicationId) {
      await rest(env, `applications?id=eq.${applicationId}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { contract_number: contractNumber }
      });
    }

    await audit(env, claims.id, 'contract_created', contractNumber, {
      employee: employeeName,
      free: isFree,
      total_cents: total
    });

    return json({ contract: inserted[0], message: `Contract ${contractNumber} created.` }, 201);
  }

  const contractPdfMatch = path.match(/^\/api\/contracts\/([^/]+)\/pdf$/);
  if (contractPdfMatch && method === 'GET') {
    const number = decodeURIComponent(contractPdfMatch[1]).toUpperCase();
    const rows = await rest(env, `contracts?contract_number=eq.${encodeURIComponent(number)}&select=*`);
    const contract = rows && rows[0];
    if (!contract) return fail('Contract not found.', 404);

    // Accès : l'admin, ou la personne concernée par la demande rattachée.
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') {
      if (!contract.application_id) return fail('Access denied.', 403);
      const apps = await rest(env, `applications?id=eq.${contract.application_id}&select=candidate_id,email`);
      const app = apps && apps[0];
      const user = await currentUser(env, claims);
      const sameUser = app && app.candidate_id && app.candidate_id === claims.id;
      const sameEmail = app && user && app.email && user.email && app.email === user.email;
      if (!sameUser && !sameEmail) return fail('Access denied.', 403);
    }

    // Logo embarqué (JPEG) utilisé en en-tête du document.
    let logo = null;
    if (typeof __ASSETS__ === 'object' && __ASSETS__['brand/contract-logo.jpg']) {
      const bytes = b64ToBytes(__ASSETS__['brand/contract-logo.jpg'].b64);
      logo = { bytes, ...jpegSize(bytes) };
    }

    const pdf = buildContractPdf(contract, logo);
    return new Response(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${contract.contract_number}.pdf"`,
        'cache-control': 'private, no-store'
      }
    });
  }

  const contractDeleteMatch = path.match(/^\/api\/admin\/contracts\/(\d+)$/);
  if (contractDeleteMatch && method === 'DELETE') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    await rest(env, `contracts?id=eq.${Number(contractDeleteMatch[1])}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });
    return json({ message: 'Contract deleted.' });
  }

  /* --------------------------------------------- webhook Stripe (public) */

  if (path === '/api/webhooks/stripe' && method === 'POST') {
    const raw = await request.text();
    const signature = request.headers.get('stripe-signature');
    // Le secret de signature peut venir de l'environnement ou de la console admin.
    const hookCreds = await loadStripeCredentials(env, rest, { force: true });
    const secret = hookCreds.webhook || env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      return fail(
        'Stripe webhook secret is not configured. An administrator can add it in the admin console (Money tab).',
        503
      );
    }
    const valid = await verifyStripeSignature(raw, signature, secret);
    if (!valid) return fail('Invalid Stripe signature.', 400);

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return fail('Invalid payload.', 400);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object || {};
      const metadata = session.metadata || {};

      // Abonnement recruteur : on active immédiatement pour 30 jours.
      if (metadata.kind === 'subscription' && metadata.subscription_id) {
        const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        await rest(env, `subscriptions?id=eq.${metadata.subscription_id}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: {
            status: 'active',
            current_period_end: periodEnd,
            stripe_session_id: session.id || null,
            stripe_customer_id: session.customer || null,
            updated_at: new Date().toISOString()
          }
        });

        if (metadata.user_id) {
          await notify(env, metadata.user_id, {
            type: 'subscription_active',
            title: 'Subscription active',
            body: 'You can now publish contracts.'
          });
        }
        return json({ received: true, subscription: 'activated' });
      }

      const paymentRef = metadata.payment_reference;

      let payment = null;
      if (paymentRef) {
        const rows = await rest(env, `payments?reference=eq.${encodeURIComponent(paymentRef)}&select=*`);
        payment = rows && rows[0];
      }
      if (!payment && session.id) {
        const rows = await rest(env, `payments?provider_session_id=eq.${encodeURIComponent(session.id)}&select=*`);
        payment = rows && rows[0];
      }
      if (!payment) return json({ received: true, ignored: 'unknown payment' });

      if (payment.status === 'paid') return json({ received: true, idempotent: true });

      const nowIso = new Date().toISOString();
      const receiptNumber = `JC-R-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

      await rest(env, `payments?id=eq.${payment.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'paid',
          paid_at: nowIso,
          receipt_number: receiptNumber,
          provider_session_id: session.id || payment.provider_session_id,
          provider_payment_intent: session.payment_intent || null
        }
      });

      if (payment.application_id) {
        await rest(env, `applications?id=eq.${payment.application_id}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { paid_at: nowIso }
        });
      }

      const apps = payment.application_id
        ? await rest(env, `applications?id=eq.${payment.application_id}&select=*`)
        : [];
      const app = (apps || [])[0];

      if (app) {
        await sendEmail(env, rest, {
          to: app.email,
          userId: app.candidate_id,
          template: 'payment_receipt',
          subject: `JobConnect payment receipt ${receiptNumber}`,
          html: emailLayout(
            'Payment confirmed',
            `<p>Hello ${app.full_name},</p>
             <p>We received your payment for request <b>${app.reference}</b>.</p>
             <table style="width:100%;font-size:13px;border-collapse:collapse">
               <tr><td style="padding:6px 0">JobConnect fee</td><td align="right">${money(payment.fee_cents, payment.currency)}</td></tr>
               <tr><td style="padding:6px 0">Recruiter price</td><td align="right">${money(payment.recruiter_price_cents, payment.currency)}</td></tr>
               <tr><td style="padding:10px 0;font-weight:800">Total paid</td><td align="right" style="font-weight:800">${money(payment.total_cents, payment.currency)}</td></tr>
             </table>
             <p>Receipt number: <b>${receiptNumber}</b></p>
             <p>Your application documents and this receipt are available in your dashboard.</p>`,
            'Keep this receipt for your records.'
          )
        });

        await notify(env, app.candidate_id, {
          type: 'payment_confirmed',
          title: 'Payment confirmed',
          body: `Receipt ${receiptNumber} — ${money(payment.total_cents, payment.currency)}`,
          application_ref: app.reference
        });
      }

      return json({ received: true });
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object || {};
      const metadata = intent.metadata || {};
      const paymentRef = metadata.payment_reference;

      let payment = null;
      if (paymentRef) {
        const rows = await rest(env, `payments?reference=eq.${encodeURIComponent(paymentRef)}&select=*`);
        payment = rows && rows[0];
      }
      if (!payment && intent.id) {
        const rows = await rest(env, `payments?provider_payment_intent=eq.${encodeURIComponent(intent.id)}&select=*`);
        payment = rows && rows[0];
      }
      if (!payment) return json({ received: true, ignored: 'unknown payment intent' });
      if (payment.status === 'paid') return json({ received: true, idempotent: true });

      const nowIso = new Date().toISOString();
      const receiptNumber = `JC-R-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

      await rest(env, `payments?id=eq.${payment.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'paid',
          paid_at: nowIso,
          receipt_number: receiptNumber,
          provider_payment_intent: intent.id
        }
      });
      if (payment.application_id) {
        await rest(env, `applications?id=eq.${payment.application_id}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { paid_at: nowIso }
        });
      }

      const apps = payment.application_id
        ? await rest(env, `applications?id=eq.${payment.application_id}&select=*`)
        : [];
      const app = (apps || [])[0];
      if (app) {
        await sendEmail(env, rest, {
          to: app.email,
          userId: app.candidate_id,
          template: 'payment_receipt',
          subject: `JobConnect payment receipt ${receiptNumber}`,
          html: emailLayout(
            'Payment confirmed',
            `<p>Hello ${app.full_name},</p>
             <p>We received your card payment for request <b>${app.reference}</b>.</p>
             <p>Amount: <b>${money(payment.total_cents, payment.currency)}</b><br>
             Receipt number: <b>${receiptNumber}</b></p>`,
            'Keep this receipt for your records.'
          )
        });
        await notify(env, app.candidate_id, {
          type: 'payment_confirmed',
          title: 'Payment confirmed',
          body: `Receipt ${receiptNumber} — ${money(payment.total_cents, payment.currency)}`,
          application_ref: app.reference
        });
      }
      return json({ received: true });
    }

    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      const session = event.data.object || {};
      const paymentRef = (session.metadata || {}).payment_reference;
      if (paymentRef) {
        await rest(env, `payments?reference=eq.${encodeURIComponent(paymentRef)}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { status: 'failed' }
        });
      }
      return json({ received: true });
    }

    return json({ received: true, ignored: event.type });
  }

  /* --------------------------------------------------- réglages admin */

  if (path === '/api/admin/settings' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    const settings = await loadSettings(env, rest);
    return json({
      settings,
      integrations: {
        payments: stripeConfigured(env),
        email: mailConfigured(env)
      }
    });
  }

  if (path === '/api/admin/settings' && method === 'PATCH') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    const body = await request.json().catch(() => ({}));
    const allowed = [
      'jobconnect_fee_cents',
      'sla_target_min_minutes',
      'sla_target_max_minutes',
      'default_recruiter_price_cents',
      'recruiter_price_cents',
      'promo_price_cents',
      'currency'
    ];
    const updates = [];
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key)) continue;
      updates.push({ key, value: String(value) });
    }
    if (!updates.length) return fail('No valid setting provided.');

    for (const item of updates) {
      await rest(env, 'settings?on_conflict=key', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { key: item.key, value: item.value, updated_at: new Date().toISOString() }
      });
    }
    SETTINGS_TTL = { at: 0, value: null };
    await audit(env, claims.id, 'settings_updated', 'platform', Object.fromEntries(updates.map((u) => [u.key, u.value])));
    return json({ message: 'Settings updated.', settings: await loadSettings(env, rest) });
  }

  if (path === '/api/admin/email-log' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    const rows = await rest(env, 'email_log?select=*&order=created_at.desc&limit=50');
    return json({ emails: rows || [] });
  }

  if (path === '/api/admin/audit-log' && method === 'GET') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'admin') return fail('Access denied.', 403);
    const rows = await rest(env, 'audit_log?select=*&order=created_at.desc&limit=50');
    return json({ entries: rows || [] });
  }

  /* ------------------------------------------------------ abonnements */

  if (path === '/api/subscriptions/checkout' && method === 'POST') {
    if (!claims) return fail('Authentication required.', 401);
    if (claims.role !== 'recruiter') return fail('Recruiter accounts only.', 403);

    const body = await request.json().catch(() => ({}));
    const planKey = body.plan === 'recruiter_promo' ? 'recruiter_promo' : 'recruiter_pro';
    const plan = PLANS[planKey];

    const existing = await activeSubscription(env, claims.id);
    if (existing) return fail('You already have an active subscription.', 409);

    const subCreds = await loadStripeCredentials(env, rest, { force: true });
    if (!subCreds.secret) {
      return fail(
        'Card payments are not configured yet. An administrator must add the receiving ' +
          'account in the admin console (Settings → Receiving account).',
        503
      );
    }

    const settings = await getSettings(env);
    // La formule promo utilise le tarif promotionnel configuré par l'admin.
    const amount = plan.promotional
      ? Number(body.amount_cents || settings.promo_price_cents || plan.amount_cents)
      : Number(settings.recruiter_price_cents || plan.amount_cents);

    const subRows = await rest(env, 'subscriptions', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: claims.id,
        plan: planKey,
        amount_cents: amount,
        currency: 'USD',
        status: 'pending_payment'
      }
    });

    const origin = env.PUBLIC_URL || new URL(request.url).origin;
    const session = await stripeRequest(env, 'checkout/sessions', {
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': amount,
      'line_items[0][price_data][product_data][name]': `${plan.name} — 1 month`,
      customer_email: claims.email || undefined,
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`,
      'metadata[subscription_id]': String(subRows[0].id),
      'metadata[kind]': 'subscription',
      'metadata[user_id]': claims.id
    }, rest);

    await rest(env, `subscriptions?id=eq.${subRows[0].id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { stripe_session_id: session.id }
    });

    return json({ checkout_url: session.url, subscription_id: subRows[0].id, amount_cents: amount }, 201);
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
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

/** Décode un asset base64 (images) vers un tableau d'octets. */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Empreinte du déploiement, remplacée par build.js. */
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

/**
 * Adresse publique officielle (sans « dz »).
 * Les anciennes adresses techniques restent valables mais renvoient vers elle,
 * pour qu'un lien déjà partagé ne casse jamais.
 */
const CANONICAL_HOST = 'jc-careers.jobconnectdz.workers.dev';
const LEGACY_HOSTS = new Set(['jc.jobconnectdz.workers.dev']);

function serveStatic(url) {
  const assets = typeof __ASSETS__ === 'object' ? __ASSETS__ : {};
  const pathname = decodeURIComponent(url.pathname);
  const key = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');

  const file = assets[key];
  if (file !== undefined) {
    const ext = extensionOf(key) || '.html';
    const isImage = file && typeof file === 'object' && file.b64 !== undefined;
    const body = isImage ? b64ToBytes(file.b64) : (typeof file === 'object' ? file.text : file);
    // Le HTML n'est jamais mis en cache : il porte les URL versionnées des
    // scripts. Les fichiers versionnés (?v=empreinte) sont immuables, donc un
    // déploiement est visible immédiatement, sans vidage de cache.
    const versioned = url.searchParams.has('v');
    const cacheControl =
      ext === '.html'
        ? 'no-store, must-revalidate'
        : isImage
          ? 'public, max-age=604800, immutable'
          : versioned
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate';
    return new Response(body, {
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': cacheControl,
        ...(ext === '.html' ? { 'x-jc-version': VERSION } : {})
      }
    });
  }

  // Single-page fallback.
  if (assets['index.html'] !== undefined && !/\.[a-z0-9]+$/i.test(key)) {
    return new Response(assets['index.html'].text, {
      headers: {
        'content-type': MIME['.html'],
        'cache-control': 'no-store, must-revalidate',
        'x-jc-version': VERSION
      }
    });
  }

  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // redirection permanente depuis l'ancienne adresse vers l'adresse courte
    if (LEGACY_HOSTS.has(url.hostname) && url.pathname !== '/api/health') {
      const target = new URL(url.pathname + url.search, `https://${CANONICAL_HOST}`);
      return Response.redirect(target.toString(), 308);
    }

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
