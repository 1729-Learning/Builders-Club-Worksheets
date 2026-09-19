'use strict';
/*
  Builders Club — signing students in with a Microsoft account.

  Multi-tenant by default: the app registration lives in whatever directory the
  instructor created it in, and students sign in with any Microsoft account —
  their school's, or a personal one. No other organization has to register,
  configure or approve anything. Setting MS_TENANT_ID narrows that to one
  directory for anyone who wants the stricter arrangement.

  The session is a signed cookie rather than a session store: the payload is
  {oid, name, email} plus timestamps, HMAC'd with SESSION_SECRET. Nothing about
  a student's identity lives on disk except the profile the roster reads.

  The instructor flag is deliberately NOT in that cookie. Roles are recomputed
  from INSTRUCTOR_EMAILS on every request, so granting or revoking instructor
  access takes effect at once and a stale cookie can never hold it open.
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
  // Railway publishes the service's own domain, so a deploy gets https cookies
  // and a correct redirect URI without anyone setting PUBLIC_BASE_URL by hand.
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const host = (req && req.headers && req.headers.host) || `localhost:${process.env.PORT || 4321}`;
  return `http://${host}`;
}

function redirectUri(req) { return publicBaseUrl(req) + '/auth/callback'; }
function secureCookies() { return publicBaseUrl().startsWith('https:'); }

// A tenant is not required: without one the app is multi-tenant and any
// Microsoft account can sign in, which is the point.
const msalConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* `common` signs in work, school and personal Microsoft accounts alike, and is
   what makes this need nothing from anybody else's IT department. A tenant id
   or domain here instead restricts sign-in to that one directory. */
const tenantId = () => String(process.env.MS_TENANT_ID || '').trim() || 'common';
const isMultiTenant = () => ['common', 'organizations', 'consumers'].includes(tenantId().toLowerCase());

/* The `tid` claim is always a GUID, so it can only be compared when a GUID was
   configured. A domain-form tenant is still enforced by the authority itself,
   and a multi-tenant deployment has nothing to compare against by design. */
function tenantMatches(tid) {
  const configured = tenantId();
  if (!GUID_RE.test(configured)) return true;
  return String(tid || '').trim().toLowerCase() === configured.toLowerCase();
}

/* Multi-tenant means the sign-in page is open to every Microsoft account in the
   world, which is fine for who may knock but not always for who may come in:
   each new account gets its own worksheets and can spend the instructor's AI
   budget. An optional domain list closes that without involving anyone's IT —
   the instructor already knows what their students' email addresses look like.
   Empty (the default) lets anyone in, which is what an open club wants. */
function allowedDomains() {
  return String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

function emailAllowed(email) {
  const domains = allowedDomains();
  if (!domains.length) return true;
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  if (at < 0) return false;
  const domain = String(email).toLowerCase().slice(at + 1);
  // A listed domain covers its subdomains, so one entry handles mail.school.edu.
  return domains.some(d => domain === d || domain.endsWith('.' + d));
}

/* Dev sign-in exists so the app can be run locally without an Entra tenant. It
   is impossible to reach once real sign-in is configured, on any Railway
   deployment, or when NODE_ENV is production — a fake-login backdoor on a live
   student site would be a serious problem, so each condition stands alone. */
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const DEV_LOGIN_ENABLED = process.env.ALLOW_DEV_LOGIN === '1'
  && !process.env.MS_CLIENT_ID
  && !IS_PRODUCTION
  && !ON_RAILWAY;

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
  // Re-checked per request, not just at sign-in: turning ALLOWED_EMAIL_DOMAINS
  // on, or narrowing it, has to evict the sessions it no longer covers rather
  // than leaving them renewing themselves for another month.
  if (!emailAllowed(payload.email)) return null;
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
    let originHost;
    try { originHost = new URL(origin).host; } catch { return false; }
    // Same-origin is the real test, and behind a proxy the Host header is what
    // the browser actually asked for — so a custom domain works without anyone
    // having configured PUBLIC_BASE_URL. An attacker's page carries their own
    // Origin, which cannot match.
    if (originHost === req.headers.host) return true;
    let expected = null;
    try { expected = new URL(publicBaseUrl(req)).host; } catch { /* unset */ }
    if (!expected || originHost !== expected) return false;
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
    const detail = query.get('error_description') || '';
    console.error('[auth] Microsoft returned an error:', query.get('error'), detail);
    // AADSTS65001 / 90094: this tenant requires an administrator to approve the
    // app. That student needs different advice from "try again", because trying
    // again will fail the same way until an admin acts — or they use a personal
    // account, which no admin controls.
    if (/AADSTS65001|AADSTS90094|consent_required|interaction_required/i.test(detail)) {
      return redirect(res, '/?auth=consent');
    }
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
  // Only when a specific tenant was configured. Multi-tenant has nothing to
  // compare against, which is the whole point of running it that way.
  if (!tenantMatches(claims.tid)) {
    console.warn('[auth] rejected a sign-in from another tenant:', claims.tid);
    return redirect(res, '/?auth=tenant');
  }
  if (!store.isOid(claims.oid)) {
    console.error('[auth] sign-in had no usable object id');
    return redirect(res, '/?auth=failed');
  }

  /* Only `preferred_username`, never the `email` claim. Entra lets a tenant
     admin set `email` to any string at all, including somebody else's address,
     so trusting it here would let anyone with their own tenant mint themselves
     an instructor address (the nOAuth pattern). A UPN's domain has to be
     verified with Entra before it can be issued, and Microsoft verifies the
     address behind a personal account, so this one can carry the decision. */
  const email = String(claims.preferred_username || '').toLowerCase();
  if (!email.includes('@')) {
    console.error('[auth] sign-in returned no usable username claim');
    return redirect(res, '/?auth=failed');
  }
  if (!emailAllowed(email)) {
    console.warn('[auth] turned away an address outside ALLOWED_EMAIL_DOMAINS:', email);
    return redirect(res, '/?auth=domain');
  }

  const user = { oid: String(claims.oid).toLowerCase(), name: claims.name || email, email };
  store.upsertProfile(user);
  issueSession(res, user);
  console.log(`[auth] signed in ${email} (${roleFor(email)})`);
  redirect(res, '/');
}

/* Class-code sign-in: the student posts the shared code and their name. Answers
   with JSON rather than a redirect so the page can show "that code doesn't look
   right" without throwing away what they typed. */
/* Local development only: a fake sign-in so the app runs without an app
   registration. `?as=<name>` gives each name its own stable student. */
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
    return {
      authenticated: false,
      loginUrl: '/auth/login',
      microsoft: msalConfigured(),
      devLogin: DEV_LOGIN_ENABLED,
      configured: msalConfigured(),
    };
  }
  return { authenticated: true, oid: user.oid, name: user.name, email: user.email, role: user.role };
}

/* ---------------------------------------------------------------- boot checks */

function validateAuthEnvOrExit() {
  const problems = [];

  if (msalConfigured()) {
    if (!process.env.SESSION_SECRET) {
      problems.push('SESSION_SECRET is required. Generate one with:  openssl rand -hex 32');
    }
    if (!process.env.PUBLIC_BASE_URL && !process.env.RAILWAY_PUBLIC_DOMAIN) {
      problems.push('PUBLIC_BASE_URL is required — it builds the redirect URI registered on your app.');
    }
  } else if (!DEV_LOGIN_ENABLED) {
    problems.push('Microsoft sign-in is not configured. Set these:');
    problems.push('');
    problems.push('       MS_CLIENT_ID        Application (client) ID from your app registration');
    problems.push('       MS_CLIENT_SECRET    the secret VALUE, not the secret ID');
    problems.push('       SESSION_SECRET      openssl rand -hex 32');
    problems.push('       INSTRUCTOR_EMAILS   your own email, so you get the student roster');
    problems.push('');
    problems.push('     Paste values raw, with no surrounding quotes.');
    problems.push('     MS_TENANT_ID is optional: leave it unset and any Microsoft account can');
    problems.push('     sign in, which needs nothing from anyone else\u2019s IT department.');
    problems.push('     For local development only, start with ALLOW_DEV_LOGIN=1 instead.');
    problems.push('');
    // "I set it and it still crashes" is nearly always the variables landing on
    // another service or environment, so show what this process can actually
    // see rather than leaving them to guess.
    const seen = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'SESSION_SECRET', 'INSTRUCTOR_EMAILS']
      .map(k => `${k}=${process.env[k] ? 'set' : 'MISSING'}`);
    problems.push('  What this server can see right now:');
    problems.push('       ' + seen.join('  '));
    problems.push('  All MISSING? The variables are on a different service or environment than this one.');
  }

  if (problems.length) {
    console.error('\n  Builders Club worksheets cannot start:\n');
    // Already-indented and blank lines are layout, not bullets.
    for (const p of problems) console.error(p === '' || p.startsWith(' ') ? p : '  • ' + p);
    console.error('\n  See .env.example for every setting.\n');
    process.exit(1);
  }

  if (msalConfigured() && !process.env.INSTRUCTOR_EMAILS) {
    console.warn('  [warn] INSTRUCTOR_EMAILS is empty — nobody can open the student roster.');
  }

  // Open by design, but the bill is real: say so once at boot rather than
  // letting it be discovered on an invoice.
  if (msalConfigured() && isMultiTenant() && !allowedDomains().length) {
    console.warn('  [warn] Anyone with a Microsoft account can sign in and use the AI reviewer.');
    console.warn('         Set ALLOWED_EMAIL_DOMAINS (e.g. yourschool.edu) to limit who can.');
  }

  // A domain list that excludes the instructor locks them out of their own site,
  // and the symptom (sign-in bounces) does not point at the cause.
  const lockedOut = instructorEmails().filter(e => !emailAllowed(e));
  if (lockedOut.length) {
    console.warn(`  [warn] ALLOWED_EMAIL_DOMAINS excludes ${lockedOut.join(', ')} — that instructor cannot sign in.`);
  }
}

function describeSignIn() {
  if (DEV_LOGIN_ENABLED) return 'DEV LOGIN ONLY — /auth/dev';
  if (!msalConfigured()) return 'none';
  const audience = isMultiTenant()
    ? (tenantId().toLowerCase() === 'consumers' ? 'personal Microsoft accounts' : 'any Microsoft account')
    : `tenant ${tenantId()} only`;
  const gate = allowedDomains().length ? `, limited to ${allowedDomains().join(', ')}` : '';
  return `Microsoft — ${audience}${gate} (${publicBaseUrl()}/auth/callback)`;
}

module.exports = {
  DEV_LOGIN_ENABLED, SESSION_COOKIE,
  msalConfigured, publicBaseUrl, describeSignIn,
  roleFor, sessionFromRequest, requireSession, requireInstructor,
  csrfOk, beginLogin, finishLogin, devLogin, logout, mePayload,
  validateAuthEnvOrExit,
  _internal: { sign, verify, parseCookies, tenantId, isMultiTenant, emailAllowed, allowedDomains },
};
