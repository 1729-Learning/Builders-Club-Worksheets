'use strict';
/*
  Builders Club — sign-in with a school Microsoft account.

  Students sign in through Microsoft Entra ID (single tenant, so only the
  school's own accounts work), and we keep a signed cookie rather than a session
  store: the payload is {oid, name, email} plus timestamps, HMAC'd with
  SESSION_SECRET. Nothing about a student's identity lives on disk except the
  profile the roster reads.

  Deliberately NOT in the cookie: the instructor flag. Roles are recomputed from
  INSTRUCTOR_EMAILS on every request, so adding an instructor takes effect
  immediately and a stale cookie can never carry elevated access.
*/

const crypto = require('crypto');
const store = require('./store.js');

const SESSION_COOKIE = 'bc_session';
const OAUTH_COOKIE = 'bc_oauth';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const REISSUE_AFTER_MS = 24 * 60 * 60 * 1000; // sliding window: refresh a day-old cookie
const OAUTH_TTL_MS = 10 * 60 * 1000;
const SCOPES = ['openid', 'profile', 'email'];

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const host = (req && req.headers && req.headers.host) || `localhost:${process.env.PORT || 4321}`;
  return `http://${host}`;
}

function redirectUri(req) { return publicBaseUrl(req) + '/auth/callback'; }
function secureCookies() { return publicBaseUrl().startsWith('https:'); }

const msalConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_TENANT_ID);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenantId = () => String(process.env.MS_TENANT_ID || '').trim();

/* The `tid` claim is always a GUID. MS_TENANT_ID may instead be set to a domain
   (contoso.onmicrosoft.com), which is valid for the authority but can never
   equal a GUID — comparing them would reject every real sign-in. In that case
   we lean on the single-tenant authority, which already limits who gets a
   token, and say so once at boot rather than failing everyone. */
let warnedTenantShape = false;
function tenantMatches(tid) {
  const configured = tenantId();
  if (!GUID_RE.test(configured)) {
    if (!warnedTenantShape) {
      warnedTenantShape = true;
      console.warn('  [warn] MS_TENANT_ID is not a GUID, so the tenant claim cannot be checked directly.');
      console.warn('         Sign-in is still limited to your tenant by the authority. Use the Directory (tenant) ID to enable the extra check.');
    }
    return true;
  }
  return String(tid || '').trim().toLowerCase() === configured.toLowerCase();
}

/* Dev sign-in exists so the app can be run locally without an Entra tenant. It
   is impossible to reach once real sign-in is configured or NODE_ENV is
   production — three independent conditions, because a fake-login backdoor on a
   live student site would be a serious problem. */
const DEV_LOGIN_ENABLED = process.env.ALLOW_DEV_LOGIN === '1' && !process.env.MS_CLIENT_ID && !IS_PRODUCTION;

let sessionSecret = process.env.SESSION_SECRET || '';
if (!sessionSecret) {
  // Dev only (boot refuses to start in production without one): a per-boot
  // secret means restarting signs you out, which is fine locally.
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

/* ---------------------------------------------------------------- signing */

const b64url = buf => Buffer.from(buf).toString('base64url');

function hmac(data) {
  return crypto.createHmac('sha256', sessionSecret).update(data).digest();
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const head = 'v1.' + body;
  return head + '.' + b64url(hmac(head));
}

function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = hmac('v1.' + parts[1]);
  let given;
  try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

/* ---------------------------------------------------------------- cookies */

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const value = part.slice(i + 1).trim();
    // A stray cookie on this host with a bad %-escape would otherwise throw
    // URIError and take down sign-in itself, with nothing the student can do.
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { decoded = value; }
    out[part.slice(0, i).trim()] = decoded;
  }
  return out;
}

const pending = new WeakMap(); // res -> [Set-Cookie strings]

function addCookie(res, str) {
  const list = pending.get(res) || [];
  list.push(str);
  pending.set(res, list);
  res.setHeader('Set-Cookie', list);
}

function setCookie(res, name, value, maxAgeMs) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secureCookies()) bits.push('Secure');
  addCookie(res, bits.join('; '));
}

function clearCookie(res, name) {
  const bits = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookies()) bits.push('Secure');
  addCookie(res, bits.join('; '));
}

/* ---------------------------------------------------------------- roles */

function instructorEmails() {
  return String(process.env.INSTRUCTOR_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function roleFor(email) {
  const e = String(email || '').toLowerCase();
  return e && instructorEmails().includes(e) ? 'instructor' : 'student';
}

/* ---------------------------------------------------------------- sessions */

function issueSession(res, { oid, name, email }) {
  const now = Date.now();
  setCookie(res, SESSION_COOKIE, sign({ oid, name, email, iat: now, exp: now + SESSION_MS }), SESSION_MS);
}

// The signed-in student, or null. Refreshes a day-old cookie so an active
// student is never logged out mid-semester.
function sessionFromRequest(req, res) {
  const payload = verify(parseCookies(req)[SESSION_COOKIE]);
  if (!payload || !store.isOid(payload.oid)) return null;
  const user = {
    oid: String(payload.oid).toLowerCase(),
    name: payload.name || '',
    email: payload.email || '',
    role: roleFor(payload.email),
  };
  if (res && Date.now() - (payload.iat || 0) > REISSUE_AFTER_MS) issueSession(res, user);
  return user;
}

function requireSession(req, res, sendJSON) {
  const user = sessionFromRequest(req, res);
  if (!user) { sendJSON(res, 401, { error: 'unauthenticated' }); return null; }
  return user;
}

function requireInstructor(req, res, sendJSON) {
  const user = requireSession(req, res, sendJSON);
  if (!user) return null;
  if (user.role !== 'instructor') { sendJSON(res, 403, { error: 'forbidden' }); return null; }
  return user;
}

/* ---------------------------------------------------------------- CSRF

   The SPA is same-origin and sends no custom headers, so the check is on
   provenance rather than a token: browsers always attach Origin to a POST made
   with fetch, and Sec-Fetch-Site tells us when a request came from elsewhere.
   SameSite=Lax on the session cookie is the backstop. Requiring a JSON
   content-type instead would break the body-less reset call. */
function csrfOk(req) {
  const origin = req.headers.origin;
  if (origin) {
    let expected;
    try { expected = new URL(publicBaseUrl(req)).origin; } catch { expected = null; }
    const localhost = `http://${req.headers.host}`;
    if (origin !== expected && origin !== localhost) return false;
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site === 'cross-site') return false;
  return true;
}

/* ---------------------------------------------------------------- MSAL */

let _cca = null;

function msalClient() {
  if (!_cca) {
    const { ConfidentialClientApplication } = require('@azure/msal-node');
    _cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.MS_CLIENT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET,
        authority: 'https://login.microsoftonline.com/' + tenantId(),
      },
    });
  }
  return _cca;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function beginLogin(req, res) {
  if (!msalConfigured()) return redirect(res, '/?auth=unconfigured');
  const nonce = crypto.randomBytes(16).toString('hex');
  setCookie(res, OAUTH_COOKIE, sign({ nonce, exp: Date.now() + OAUTH_TTL_MS }), OAUTH_TTL_MS);
  try {
    const url = await msalClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: redirectUri(req),
      state: nonce,
      responseMode: 'query',
    });
    redirect(res, url);
  } catch (e) {
    console.error('[auth] could not build the sign-in URL:', e.message);
    redirect(res, '/?auth=failed');
  }
}

async function finishLogin(req, res, query) {
  if (!msalConfigured()) return redirect(res, '/?auth=unconfigured');

  if (query.get('error')) {
    console.error('[auth] Microsoft returned an error:', query.get('error'), query.get('error_description') || '');
    return redirect(res, '/?auth=failed');
  }

  // The state nonce must match the cookie we set moments ago — that is what
  // makes this callback ours and not a replay.
  const saved = verify(parseCookies(req)[OAUTH_COOKIE]);
  clearCookie(res, OAUTH_COOKIE);
  if (!saved || !query.get('state') || query.get('state') !== saved.nonce) {
    return redirect(res, '/?auth=expired');
  }

  const code = query.get('code');
  if (!code) return redirect(res, '/?auth=failed');

  let result;
  try {
    result = await msalClient().acquireTokenByCode({
      code, scopes: SCOPES, redirectUri: redirectUri(req),
    });
  } catch (e) {
    console.error('[auth] token exchange failed:', e.message);
    return redirect(res, '/?auth=failed');
  }

  const claims = (result && result.idTokenClaims) || {};
  // Single tenant: a personal Microsoft account carries a different tid and is
  // turned away with a message that tells them which account to use.
  if (!tenantMatches(claims.tid)) {
    console.warn('[auth] rejected a sign-in from another tenant:', claims.tid);
    return redirect(res, '/?auth=tenant');
  }
  if (!store.isOid(claims.oid)) {
    console.error('[auth] sign-in had no usable object id');
    return redirect(res, '/?auth=failed');
  }

  const email = String(claims.preferred_username || claims.email || '').toLowerCase();
  const user = { oid: String(claims.oid).toLowerCase(), name: claims.name || email, email };
  store.upsertProfile(user);
  issueSession(res, user);
  console.log(`[auth] signed in ${email} (${roleFor(email)})`);
  redirect(res, '/');
}

/* Local development only: a fake sign-in so the app runs without an Entra
   tenant. `?as=<name>` gives each name its own stable student. */
function devLogin(req, res, query) {
  if (!DEV_LOGIN_ENABLED) { res.writeHead(404); return res.end('not found'); }
  const slug = String(query.get('as') || 'student').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'student';
  const hash = crypto.createHash('sha256').update(slug).digest('hex').slice(0, 12);
  const user = {
    oid: `00000000-0000-4000-8000-${hash}`,
    name: slug.replace(/(^|-)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()),
    email: `${slug}@dev.local`,
  };
  store.upsertProfile(user);
  issueSession(res, user);
  console.log(`[auth] dev sign-in as ${user.email} (${roleFor(user.email)})`);
  redirect(res, '/');
}

function logout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  redirect(res, '/');
}

function mePayload(req, res) {
  const user = sessionFromRequest(req, res);
  if (!user) {
    return { authenticated: false, loginUrl: '/auth/login', devLogin: DEV_LOGIN_ENABLED, configured: msalConfigured() };
  }
  return { authenticated: true, oid: user.oid, name: user.name, email: user.email, role: user.role };
}

/* ---------------------------------------------------------------- boot checks */

function validateAuthEnvOrExit() {
  const problems = [];
  if (msalConfigured()) {
    if (!process.env.SESSION_SECRET) problems.push('SESSION_SECRET is required once Microsoft sign-in is configured (generate one with: openssl rand -hex 32)');
    if (!process.env.PUBLIC_BASE_URL) problems.push('PUBLIC_BASE_URL is required — it builds the redirect URI registered on your Entra app');
  } else if (!DEV_LOGIN_ENABLED) {
    problems.push('No sign-in is configured. Set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (plus SESSION_SECRET and PUBLIC_BASE_URL),');
    problems.push('  or, for local development only, start with ALLOW_DEV_LOGIN=1.');
  }
  if (problems.length) {
    console.error('\n  Builders Club worksheets cannot start:\n');
    for (const p of problems) console.error('  • ' + p);
    console.error('\n  See .env.example for every setting.\n');
    process.exit(1);
  }
  if (!process.env.INSTRUCTOR_EMAILS) {
    console.warn('  [warn] INSTRUCTOR_EMAILS is empty — nobody can open the student roster.');
  }
}

module.exports = {
  DEV_LOGIN_ENABLED, SESSION_COOKIE,
  msalConfigured, publicBaseUrl,
  roleFor, sessionFromRequest, requireSession, requireInstructor,
  csrfOk, beginLogin, finishLogin, devLogin, logout, mePayload,
  validateAuthEnvOrExit,
  _internal: { sign, verify, parseCookies },
};
