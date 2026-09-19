'use strict';
/*
  Builders Club — signing students in.

  Two ways in, either or both of which can be configured:

    Microsoft Entra ID, single tenant, so only the school's own accounts work.
    A shared class code plus the student's own name, for schools that can't
    hand out an app registration.

  Either way the session is a signed cookie rather than a session store: the
  payload is {oid, name, email} plus timestamps, HMAC'd with SESSION_SECRET.
  Nothing about a student's identity lives on disk except the profile the
  roster reads.

  Roles are never simply trusted from that cookie. A Microsoft session has an
  email, so its role is recomputed from INSTRUCTOR_EMAILS on every request. A
  class-code session has no email, so the cookie records which code was used
  plus a fingerprint of that code, and the fingerprint is re-checked on every
  request — changing INSTRUCTOR_CODE revokes every session it ever granted.
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

/* ---------------------------------------------------------------- class code

   Sign-in for schools that can't hand out an Entra app registration. Students
   type a shared class code and their own name; the name is their identity, so
   everyone keeps their own worksheets without any account to create.

   Two codes, not one. A name alone cannot be trusted — a student who typed the
   instructor's name would otherwise land in the roster and read the whole
   class's work — so instructor access takes a separate, private code. Which one
   was used is recorded in the signed cookie, where a student cannot forge it. */

const normalizeCode = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/* Hosting dashboards take a raw value, but the docs and boot messages show
   shell-style lines, so a pasted CLASS_CODE="Builders Club" arrives with its
   quotes attached — and then nothing a student types ever matches. Strip a
   matched pair rather than making everyone debug an invisible character. */
function envCode(name) {
  const raw = String(process.env[name] || '').trim();
  const unquoted = raw.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  return unquoted;
}

const classCode = () => envCode('CLASS_CODE');
const instructorCode = () => envCode('INSTRUCTOR_CODE');
const classLoginEnabled = () => !!classCode();

// Constant-time compare so the codes can't be guessed a character at a time.
function codeMatches(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(normalizeCode(given));
  const b = Buffer.from(normalizeCode(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* A student is their name, so the same name must always reach the same
   worksheets: normalize away case, spacing and punctuation, then hash to a
   stable id. Letters of every script are kept — dropping anything non-Latin
   would turn two different names into the same empty string, and hand two
   students one set of worksheets. Two students with genuinely identical names
   do share a folder, which is the accepted cost of signing in with a name. */
function normalizeName(name) {
  return String(name || '').trim().toLowerCase()
    .normalize('NFKD').replace(/\p{M}+/gu, '')          // fold accents onto their base letter
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/* The instructor's folder is seeded differently, so a student who types the
   instructor's name lands in their own student folder rather than opening the
   instructor's worksheets. Two students sharing a name still share a folder;
   that is the accepted cost of signing in with a name alone. */
function oidForName(name, isInstructor) {
  const seed = (isInstructor ? 'class-instructor:' : 'class:') + normalizeName(name);
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `00000000-0000-4000-9000-${hash}`;
}

/* Tidy a typed name for display without mangling it: capitalize words that were
   typed all-lowercase, and leave anything with deliberate capitals ("McDonald",
   an all-caps surname) exactly as the student wrote it. */
function titleCase(name) {
  return String(name || '').trim().replace(/\s+/g, ' ')
    .split(' ')
    .map(w => (w === w.toLowerCase()
      ? w.replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
      : w))
    .join(' ');
}

/* Dev sign-in exists so the app can be run locally without an Entra tenant. It
   is impossible to reach once real sign-in is configured, on any Railway
   deployment, or when NODE_ENV is production — a fake-login backdoor on a live
   student site would be a serious problem, so each condition stands alone. */
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const DEV_LOGIN_ENABLED = process.env.ALLOW_DEV_LOGIN === '1'
  && !process.env.MS_CLIENT_ID
  && !process.env.CLASS_CODE
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

/* Where a session's role comes from depends on how it was created.

   Microsoft and dev sign-ins carry a real email, so the role is recomputed from
   INSTRUCTOR_EMAILS on every request: adding an instructor takes effect at once
   and a stale cookie can never hold access open.

   A class-code sign-in has no email to check — the only proof is which code was
   typed, recorded as `ins` when the session was issued. The cookie is HMAC'd,
   so a student cannot set that flag themselves. It also carries `ik`, a
   fingerprint of the instructor code in force at the time, and that is checked
   again here: changing INSTRUCTOR_CODE therefore drops every instructor session
   it ever issued, which is what makes a leaked code recoverable. */
function instructorCodeFingerprint() {
  const code = instructorCode();
  if (!code) return '';
  return crypto.createHash('sha256').update('ik:' + normalizeCode(code)).digest('hex').slice(0, 16);
}

function roleForSession(payload) {
  if (payload.via === 'class') {
    if (!payload.ins) return 'student';
    const current = instructorCodeFingerprint();
    return current && payload.ik === current ? 'instructor' : 'student';
  }
  return roleFor(payload.email);
}

/* ---------------------------------------------------------------- sessions */

function issueSession(res, { oid, name, email, via, ins }) {
  const now = Date.now();
  const payload = { oid, name, email, via: via || 'ms', iat: now, exp: now + SESSION_MS };
  if (ins) { payload.ins = true; payload.ik = instructorCodeFingerprint(); }
  setCookie(res, SESSION_COOKIE, sign(payload), SESSION_MS);
}

// The signed-in student, or null. Refreshes a day-old cookie so an active
// student is never logged out mid-semester.
function sessionFromRequest(req, res) {
  const payload = verify(parseCookies(req)[SESSION_COOKIE]);
  if (!payload || !store.isOid(payload.oid)) return null;
  const role = roleForSession(payload);
  const user = {
    oid: String(payload.oid).toLowerCase(),
    name: payload.name || '',
    email: payload.email || '',
    via: payload.via || 'ms',
    // Carry the role we just decided, not the raw flag: renewing a session
    // whose instructor code has since changed must not mint a fresh
    // fingerprint and hand the access straight back.
    ins: role === 'instructor',
    role,
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
  const user = { oid: String(claims.oid).toLowerCase(), name: claims.name || email, email, via: 'ms' };
  store.upsertProfile(user);
  issueSession(res, user);
  console.log(`[auth] signed in ${email} (${roleFor(email)})`);
  redirect(res, '/');
}

/* Class-code sign-in: the student posts the shared code and their name. Answers
   with JSON rather than a redirect so the page can show "that code doesn't look
   right" without throwing away what they typed. */
/* The instructor code is the only thing standing between a student and the
   whole class's work, and the sign-in form is open to anyone. Wrong codes are
   counted per caller and the door closes for a while — enough to make guessing
   a short code impractical without locking out a student who fat-fingers it. */
const GUESS_LIMIT = 10;
const GUESS_WINDOW_MS = 15 * 60 * 1000;
const guesses = new Map(); // caller -> { count, resetAt }

function callerKey(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function guessesExhausted(req) {
  const rec = guesses.get(callerKey(req));
  return !!(rec && rec.count >= GUESS_LIMIT && Date.now() < rec.resetAt);
}

function recordBadGuess(req) {
  const key = callerKey(req);
  const now = Date.now();
  const rec = guesses.get(key);
  if (!rec || now >= rec.resetAt) guesses.set(key, { count: 1, resetAt: now + GUESS_WINDOW_MS });
  else rec.count += 1;
  // Keep the map from growing without bound on a long-lived server.
  if (guesses.size > 5000) {
    for (const [k, v] of guesses) if (now >= v.resetAt) guesses.delete(k);
  }
}

async function classLogin(req, res, body, sendJSON) {
  if (!classLoginEnabled()) return sendJSON(res, 404, { error: 'class sign-in is not enabled' });

  const code = String((body && body.code) || '');
  const rawName = String((body && body.name) || '');
  const name = titleCase(rawName);

  if (!normalizeName(rawName)) {
    return sendJSON(res, 400, { error: 'Enter your name so your work is saved under it.' });
  }
  if (normalizeName(rawName).length < 2) {
    return sendJSON(res, 400, { error: 'That name is too short — use the name your instructor knows you by.' });
  }

  /* The class code is checked first and is never rate-limited. A school sits
     behind one public address, so counting every wrong code against that
     address would let one student's typos lock out the whole room — and the
     class code is shared openly anyway, so guessing it is not the threat.

     Anything else is either a typo or someone reaching for the instructor
     code, which is the real secret. Those attempts are the ones we count, and
     once the budget is spent we stop checking rather than keep answering. */
  if (codeMatches(code, classCode())) {
    return startClassSession(res, { rawName, name, isInstructor: false }, sendJSON);
  }

  if (guessesExhausted(req)) {
    return sendJSON(res, 429, { error: 'Too many tries. Wait a few minutes, then check the code with your instructor.' });
  }

  if (!codeMatches(code, instructorCode())) {
    recordBadGuess(req);
    return sendJSON(res, 401, { error: 'That class code doesn’t look right. Check it with your instructor.' });
  }

  guesses.delete(callerKey(req)); // the instructor got it right — clear the slate
  return startClassSession(res, { rawName, name, isInstructor: true }, sendJSON);
}

function startClassSession(res, { rawName, name, isInstructor }, sendJSON) {
  const user = {
    oid: oidForName(rawName, isInstructor),
    name,
    email: '',              // no email exists for a class-code student
    via: 'class',
    ins: isInstructor,
  };
  store.upsertProfile(user);
  issueSession(res, user);
  console.log(`[auth] class sign-in: ${name} (${isInstructor ? 'instructor' : 'student'})`);
  return sendJSON(res, 200, { ok: true });
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
  user.via = 'dev';
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
    // Which sign-in methods the page should offer. Both can be on at once.
    return {
      authenticated: false,
      loginUrl: '/auth/login',
      microsoft: msalConfigured(),
      classLogin: classLoginEnabled(),
      devLogin: DEV_LOGIN_ENABLED,
      configured: msalConfigured() || classLoginEnabled(),
    };
  }
  return { authenticated: true, oid: user.oid, name: user.name, email: user.email, role: user.role, via: user.via };
}

/* ---------------------------------------------------------------- boot checks */

function validateAuthEnvOrExit() {
  const problems = [];
  const realSignIn = msalConfigured() || classLoginEnabled();

  if (realSignIn) {
    if (!process.env.SESSION_SECRET) {
      problems.push('SESSION_SECRET is required. Generate one with:  openssl rand -hex 32');
    }
    if (msalConfigured() && !process.env.PUBLIC_BASE_URL && !process.env.RAILWAY_PUBLIC_DOMAIN) {
      problems.push('PUBLIC_BASE_URL is required — it builds the redirect URI registered on your Entra app');
    }
  } else if (!DEV_LOGIN_ENABLED) {
    problems.push('No sign-in is configured. Pick one:');
    problems.push('');
    problems.push('  a) Class code — no Microsoft account needed. Students type a shared code and their name.');
    problems.push('     Set these three (values raw, with no surrounding quotes):');
    problems.push('       CLASS_CODE         e.g. Builders Club');
    problems.push('       INSTRUCTOR_CODE    a private code only you know, 10+ characters');
    problems.push('       SESSION_SECRET     openssl rand -hex 32');
    problems.push('');
    problems.push('  b) Microsoft accounts — needs an app registration:');
    problems.push('       MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SESSION_SECRET');
    problems.push('');
    problems.push('  c) Local development only: start with ALLOW_DEV_LOGIN=1');
    problems.push('');
    // "I set it and it still crashes" is nearly always the variables landing on
    // another service or environment, so show what this process can actually
    // see rather than leaving them to guess.
    const seen = ['CLASS_CODE', 'INSTRUCTOR_CODE', 'SESSION_SECRET', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET']
      .map(k => `${k}=${process.env[k] ? 'set' : 'MISSING'}`);
    problems.push('  What this server can see right now:');
    problems.push('       ' + seen.join('  '));
    problems.push('  All MISSING? The variables are on a different service or environment than this one.');
  }

  // A class code with no instructor code means nobody can reach the roster, and
  // the same code would otherwise have to serve both — say so before boot.
  if (classLoginEnabled() && !instructorCode()) {
    problems.push('INSTRUCTOR_CODE is required alongside CLASS_CODE — without it nobody can open the student roster.');
  }
  if (classLoginEnabled() && instructorCode() && normalizeCode(classCode()) === normalizeCode(instructorCode())) {
    problems.push('INSTRUCTOR_CODE must be different from CLASS_CODE, or every student signs in as an instructor.');
  }
  // The class code is meant to be shared; the instructor code is the actual
  // secret, and a short one is worth guessing.
  if (classLoginEnabled() && instructorCode() && instructorCode().length < 10) {
    problems.push('INSTRUCTOR_CODE is too short — use at least 10 characters. It is the only thing protecting the whole class’s work.');
  }

  if (problems.length) {
    console.error('\n  Builders Club worksheets cannot start:\n');
    // Already-indented and blank lines are layout, not bullets.
    for (const p of problems) console.error(p === '' || p.startsWith(' ') ? p : '  • ' + p);
    console.error('\n  See .env.example for every setting.\n');
    process.exit(1);
  }
  // Only the email-based sign-ins read INSTRUCTOR_EMAILS; class code uses its
  // own INSTRUCTOR_CODE, which is required above.
  if (!classLoginEnabled() && !process.env.INSTRUCTOR_EMAILS) {
    console.warn('  [warn] INSTRUCTOR_EMAILS is empty — nobody can open the student roster.');
  }
}

function describeSignIn() {
  const parts = [];
  if (msalConfigured()) parts.push('Microsoft (' + publicBaseUrl() + '/auth/callback)');
  if (classLoginEnabled()) parts.push(`class code "${classCode()}"`);
  if (DEV_LOGIN_ENABLED) parts.push('DEV LOGIN — /auth/dev');
  return parts.length ? parts.join(' + ') : 'none';
}

module.exports = {
  DEV_LOGIN_ENABLED, SESSION_COOKIE,
  msalConfigured, classLoginEnabled, publicBaseUrl, describeSignIn,
  roleFor, sessionFromRequest, requireSession, requireInstructor,
  csrfOk, beginLogin, finishLogin, classLogin, devLogin, logout, mePayload,
  validateAuthEnvOrExit,
  _internal: { sign, verify, parseCookies, oidForName, normalizeName, codeMatches, titleCase },
};
