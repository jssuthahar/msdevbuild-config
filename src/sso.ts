/**
 * One sign-in for every MSDEVBUILD site, browser side. The api half (and why
 * it is safe) is msdevbuild-admin api/src/sso.js.
 *
 * Two cookies, both on .msdevbuild.com:
 *   msdb_session  HttpOnly Firebase session cookie, set and read only by
 *                 admin.msdevbuild.com/api/sso. No page can see it.
 *   msdb_auth     "in" | "out": a hint the sites set themselves, so a visitor
 *                 who never signed in costs no api call at all, and a sign-out
 *                 on one site reaches the other on its next page load.
 *
 * Only on the live *.msdevbuild.com hosts; localhost and previews keep plain,
 * per-site sign-in.
 */
const API = 'https://admin.msdevbuild.com/api/sso';
const HINT = 'msdb_auth';

export const ssoAvailable = () => typeof location !== 'undefined' && /(^|\.)msdevbuild\.com$/.test(location.hostname) && location.protocol === 'https:';

export function ssoState(): 'in' | 'out' | '' {
  if (!ssoAvailable()) return '';
  const m = document.cookie.match(/(?:^|;\s*)msdb_auth=(in|out)/);
  return (m?.[1] as 'in' | 'out') ?? '';
}

function setState(v: 'in' | 'out' | '') {
  const base = `; Domain=msdevbuild.com; Path=/; Secure; SameSite=Lax`;
  document.cookie = v ? `${HINT}=${v}${base}; Max-Age=${14 * 86400}` : `${HINT}=${base}; Max-Age=0`;
}

let sharing: Promise<void> | null = null;

/** After a sign-in on this site: share it. `idToken` is the Firebase ID token. One call at a time. */
export function ssoShare(idToken: string): Promise<void> {
  if (!ssoAvailable() || !idToken) return Promise.resolve();
  return (sharing ??= share(idToken).finally(() => { sharing = null; }));
}

async function share(idToken: string) {
  try {
    // text/plain keeps this a "simple" request: no CORS preflight.
    const r = await fetch(`${API}/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: idToken });
    if ((await r.json())?.ok) setState('in');
  } catch { /* offline: this site stays signed in, the other just won't follow */ }
}

/** Signed out here, but signed in on another MSDEVBUILD site? Returns a custom token to sign in with, or null. */
export async function ssoToken(): Promise<string | null> {
  if (ssoState() !== 'in') return null;
  try {
    const r = await fetch(`${API}/token`, { credentials: 'include' });
    const d = await r.json();
    if (d?.token) return d.token;
    setState(''); // session ended (expired, revoked): stop asking
  } catch { /* offline: try again next page */ }
  return null;
}

/** Signing out here signs out everywhere. */
export async function ssoSignOut() {
  if (!ssoAvailable()) return;
  setState('out');
  try { await fetch(`${API}/logout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: '' }); } catch { /* cookie expires anyway */ }
}

/** True when another site signed out since this one signed in: sign out here too. */
export const ssoSignedOutElsewhere = () => ssoState() === 'out';
