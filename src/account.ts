/**
 * Sign-in and profiles, shared by MSDEVBUILD sites.
 *
 * One Firebase project, so one account works on every site (each site keeps
 * its own sign-in session, as browsers keep storage per domain).
 *
 *   - startAccount(): Google sign-in for sites without their own (the blog).
 *     Firebase Auth is loaded only on "Sign in", or when this browser signed in
 *     before. The site passes a loader for its own `firebase` package, because
 *     this shared package cannot import it reliably from every site.
 *   - window.msdbAccount: the small bridge the profile editor uses. Sites with
 *     their own sign-in (azure.msdevbuild.com) set it too.
 *   - getProfile / saveProfile: profiles/{uid} over Firestore REST with the
 *     user's ID token. firestore.rules: only the owner (and the admin) can
 *     read it, only the owner can write it.
 *
 * UI hooks: <html data-auth="in|out">, the `msdb-auth` event (detail = Hint or
 * null), [data-account-signin], [data-account-signout], [data-profile-open].
 */
import { FIREBASE, FIRESTORE_REST } from './firebase';
import { COUNTRY_NAMES } from './country';
import { ssoShare, ssoToken, ssoSignOut, ssoState, ssoSignedOutElsewhere } from './sso';

export interface Hint { uid: string; name: string; email: string; photo: string }
export interface Profile { name: string; headline: string; bio: string; country: string; linkedin: string; github: string; website: string; updatedAt?: string }
export interface AccountBridge {
  user(): Hint | null;
  idToken(): Promise<string | null>;
  /** Also shows the new name in the header and on the Firebase account. */
  setDisplayName(name: string): Promise<void>;
}
declare global { interface Window { msdbAccount?: AccountBridge } }

const HINT = 'msdb-user';
export const hint = (): Hint | null => { try { return JSON.parse(localStorage.getItem(HINT) || 'null'); } catch { return null; } };
export function setHint(h: Hint | null) {
  try { h ? localStorage.setItem(HINT, JSON.stringify(h)) : localStorage.removeItem(HINT); } catch { /* blocked */ }
  document.documentElement.dataset.auth = h ? 'in' : 'out';
  window.dispatchEvent(new CustomEvent('msdb-auth', { detail: h }));
}

/* --------------------------------------------------------------- profiles */

export const PROFILE_LIMITS = { name: 60, headline: 80, bio: 500, url: 200 } as const;
const URL_RE = /^https:\/\/\S{4,200}$/;
const str = (doc: any, k: string) => doc?.fields?.[k]?.stringValue ?? '';

export async function getProfile(): Promise<Profile | null> {
  const a = window.msdbAccount;
  const u = a?.user();
  const token = await a?.idToken();
  if (!u || !token) return null;
  const r = await fetch(`${FIRESTORE_REST}/profiles/${u.uid}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return { name: u.name, headline: '', bio: '', country: '', linkedin: '', github: '', website: '' };
  if (!r.ok) throw new Error(`profile ${r.status}`);
  const d = await r.json();
  return {
    name: str(d, 'name') || u.name, headline: str(d, 'headline'), bio: str(d, 'bio'), country: str(d, 'country'),
    linkedin: str(d, 'linkedin'), github: str(d, 'github'), website: str(d, 'website'), updatedAt: d?.fields?.updatedAt?.timestampValue,
  };
}

/** Throws Error('invalid:<field>') for anything the rules would refuse, so the form can point at it. */
export function cleanProfile(p: Profile): Profile {
  const t = (v: string, max: number) => String(v ?? '').trim().slice(0, max);
  const out: Profile = {
    name: t(p.name, PROFILE_LIMITS.name), headline: t(p.headline, PROFILE_LIMITS.headline), bio: t(p.bio, PROFILE_LIMITS.bio),
    country: COUNTRY_NAMES[p.country] ? p.country : '',
    linkedin: t(p.linkedin, PROFILE_LIMITS.url), github: t(p.github, PROFILE_LIMITS.url), website: t(p.website, PROFILE_LIMITS.url),
  };
  if (out.name.length < 2) throw new Error('invalid:name');
  for (const k of ['linkedin', 'github', 'website'] as const) {
    if (!out[k]) continue;
    // "linkedin.com/in/you" is fine; another scheme (javascript:, mailto:) is not.
    if (/^[a-z][a-z0-9+.-]*:/i.test(out[k]) && !/^https?:\/\//i.test(out[k])) throw new Error(`invalid:${k}`);
    if (!/^https?:\/\//i.test(out[k])) out[k] = `https://${out[k]}`;
    out[k] = out[k].replace(/^http:\/\//i, 'https://');
    let host = '';
    try { host = new URL(out[k]).hostname; } catch { /* not a URL */ }
    if (!host.includes('.') || !URL_RE.test(out[k])) throw new Error(`invalid:${k}`);
  }
  return out;
}

export async function saveProfile(input: Profile): Promise<Profile> {
  const a = window.msdbAccount;
  const u = a?.user();
  const token = await a?.idToken();
  if (!u || !token) throw new Error('signed-out');
  const p = cleanProfile(input);
  const fields = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'updatedAt').map(([k, v]) => [k, { stringValue: v }]));
  const r = await fetch(`${FIRESTORE_REST}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ writes: [{
      update: { name: `projects/${FIREBASE.projectId}/databases/(default)/documents/profiles/${u.uid}`, fields },
      // Server-stamped: the rules require updatedAt == request.time.
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    }] }),
  });
  if (!r.ok) throw new Error(`profile ${r.status}`);
  if (p.name !== u.name) await a!.setDisplayName(p.name).catch(() => {});
  return p;
}

/* --------------------------------------------------- sign-in (blog et al.) */

type Loader = () => Promise<[any, any]>; // [firebase/app, firebase/auth] modules
export interface AccountOptions {
  /** Web config with apiKey (Firebase → Project settings). No apiKey = sign-in is hidden. */
  firebase: Record<string, string>;
  /** () => Promise.all([import('firebase/app'), import('firebase/auth')]) — from the site, so its own package is used. */
  load: Loader;
  /**
   * The live site's host (e.g. blog.msdevbuild.com). On that host sign-in runs
   * through the site's own /__/auth/handler (scripts/auth-helper.mjs), so
   * Google names our domain, not msdevbuild-azure.firebaseapp.com. Elsewhere
   * (localhost, previews) the default handler is used.
   */
  authHost?: string;
}

let opts: AccountOptions | null = null;
/** Set while this site is signing someone in, so that sign-in is shared rather than undone. */
let fresh = false;
let authP: Promise<{ auth: any; m: any }> | null = null;

function getAuth() {
  return (authP ??= opts!.load().then(([appM, m]) => {
    const own = opts!.authHost && location.hostname === opts!.authHost;
    const config = own ? { ...opts!.firebase, authDomain: opts!.authHost } : opts!.firebase;
    const app = appM.getApps().find((x: any) => x.name === 'msdb-account') ?? appM.initializeApp(config, 'msdb-account');
    const auth = m.getAuth(app);
    let triedSso = false;
    let first = true;
    m.onAuthStateChanged(auth, async (u: any) => {
      try { if (sessionStorage.getItem('msdb-auth-redirect')) fresh = true; sessionStorage.removeItem('msdb-auth-redirect'); } catch { /* blocked */ }
      // Only the first report on a page is the remembered user. Signed out on
      // another MSDEVBUILD site since, and not signing in here now? Sign out.
      const remembered = first && !fresh;
      first = false;
      if (u && remembered && ssoSignedOutElsewhere()) {
        await m.signOut(auth);
        return;
      }
      if (u) {
        setHint({ uid: u.uid, name: u.displayName || 'Reader', email: u.email || '', photo: u.photoURL || '' });
        // Share it, so the other MSDEVBUILD sites sign in too (src/sso.ts).
        if (ssoState() !== 'in') void u.getIdToken().then(ssoShare).catch(() => {});
        return;
      }
      // Signed out here: signed in on another MSDEVBUILD site? Then sign in quietly.
      if (!triedSso) {
        triedSso = true;
        const token = await ssoToken();
        if (token) { try { fresh = true; await m.signInWithCustomToken(auth, token); return; } catch { fresh = false; } }
      }
      setHint(null);
    });
    m.getRedirectResult(auth).catch(() => {});
    return { auth, m };
  }));
}

export async function signIn() {
  if (!opts) return;
  window.dispatchEvent(new CustomEvent('msdb-sync', { detail: { state: 'signing-in' } }));
  try { sessionStorage.setItem('msdb-auth-redirect', '1'); } catch { /* blocked */ }
  const { auth, m } = await getAuth();
  fresh = true;
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await m.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    // Installed app on iOS and strict popup blockers: a full-page redirect instead.
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await m.signInWithRedirect(auth, provider);
    else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      fresh = false;
      window.dispatchEvent(new CustomEvent('msdb-sync', { detail: { state: 'error', code } }));
      return;
    }
    else fresh = false; // closed the popup
  }
  window.dispatchEvent(new CustomEvent('msdb-sync', { detail: { state: 'idle' } }));
}

/** Signs out here and on every MSDEVBUILD site. */
export async function signOut() {
  if (!opts) return;
  await ssoSignOut();
  const { auth, m } = await getAuth();
  await m.signOut(auth);
  setHint(null);
}


/** Once per page load. Safe to call again after a view-transition swap. */
export function startAccount(options: AccountOptions) {
  const first = !opts;
  opts = options;
  if (!options.firebase.apiKey) { document.documentElement.dataset.auth = 'none'; return; }
  const h = hint();
  document.documentElement.dataset.auth = h ? 'in' : 'out';
  window.msdbAccount ??= {
    user: hint,
    idToken: async () => { const { auth } = await getAuth(); return auth.currentUser ? auth.currentUser.getIdToken() : null; },
    setDisplayName: async (name) => {
      const { auth, m } = await getAuth();
      if (!auth.currentUser) return;
      await m.updateProfile(auth.currentUser, { displayName: name });
      const cur = hint();
      if (cur) setHint({ ...cur, name });
    },
  };
  if (!first) return;
  // Signed in before (Firebase then confirms, or signs out if another site
  // signed out since), back from a redirect sign-in, or signed in on another
  // MSDEVBUILD site (sso): load Firebase in the background.
  let back = false;
  try { back = !!sessionStorage.getItem('msdb-auth-redirect'); } catch { /* blocked */ }
  if (h || back || ssoState() === 'in') {
    const go = () => void getAuth();
    'requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1);
  }
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('[data-account-signin]')) {
      e.preventDefault();
      // The "Sign in to MSDEVBUILD" dialog when the page has it, else straight to Google.
      const dlg = document.getElementById('msdb-signin') as HTMLDialogElement | null;
      if (dlg) dlg.showModal(); else void signIn();
    }
    else if (t.closest?.('[data-account-signout]')) { e.preventDefault(); void signOut(); }
  });
}
