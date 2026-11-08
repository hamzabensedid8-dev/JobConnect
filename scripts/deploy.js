#!/usr/bin/env node
/**
 * Deploys dist/worker.js to Cloudflare Workers using only the REST API.
 * No wrangler install required.
 *
 * Required environment variables:
 *   CLOUDFLARE_API_TOKEN   API token with Workers Scripts:Edit
 *   CLOUDFLARE_ACCOUNT_ID  Cloudflare account id
 *   SUPABASE_URL           https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY   service_role key (never commit it)
 *   JWT_SECRET             random string, 32+ characters
 *
 * Optional:
 *   WORKER_NAME            defaults to "jobconnect-api"
 *   CORS_ORIGIN            defaults to "*"
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const name = process.env.WORKER_NAME || 'jobconnect-api';

const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const auth = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

async function cf(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`${init.method || 'GET'} ${url} failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result;
}

// 1. Upload the bundled worker as an ES module.
const code = await readFile(path.join(root, 'dist', 'worker.js'), 'utf8');
const form = new FormData();
form.set('metadata', new Blob([JSON.stringify({ main_module: 'worker.js' })], { type: 'application/json' }));
form.set('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

const uploaded = await cf(`${api}/workers/scripts/${name}`, { method: 'PUT', body: form });
console.log(`deployed ${name} (etag ${String(uploaded.etag).slice(0, 12)}...)`);

// 2. Secrets (stored encrypted; never in the repo).
const secrets = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

for (const [key, value] of Object.entries(secrets)) {
  await cf(`${api}/workers/scripts/${name}/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: key, text: value, type: 'secret_text' })
  });
  console.log(`secret set: ${key}`);
}

// 3. Make sure the workers.dev route is live.
await cf(`${api}/workers/scripts/${name}/subdomain`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enabled: true })
});

const subdomain = await cf(`${api}/workers/subdomain`);
console.log(`\nLive at: https://${name}.${subdomain.subdomain}.workers.dev`);
