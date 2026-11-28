/**
 * What the admin portal controls on a public site, in one small module with no
 * dependencies (Firestore REST, no SDK):
 *
 *   - siteConfig/{site}: feature switches, a featured item and live promotions,
 *     published by admin.msdevbuild.com. One read per page load at most
 *     (cached for 5 minutes in localStorage).
 *   - Promotion bars and pop-ups, with a +1 view/click counter each.
 *   - Campaign landings (?utm_campaign=<a campaign short name>): remembered for
 *     30 days so a later sign-up can carry `campaign`, and counted once a day.
 *   - Push opens (?pn=<notification id>): counted once.
 *
 * Counts are anonymous +1s (firestore.rules allows nothing else), skipped for
 * Do Not Track / Global Privacy Control and off the live *.msdevbuild.com hosts.
 * Nothing about the visitor is stored anywhere but their own browser.
 */
import { FIREBASE, FIRESTORE_REST } from './firebase';

export interface Promo {
  id: string; kind: 'bar' | 'popup'; tone: 'brand' | 'info' | 'success' | 'warn';
  title: string; text: string; cta: string; url: string; startAt: string; endAt: string; paths: string[];
}
export interface SiteConfig {
  v: number; site: string;
  features: Record<string, boolean>;
  featured: { label: string; title: string; text: string; url: string } | null;
  promos: Promo[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
const PUSH_ID = /^[A-Za-z0-9]{20}$/;
const CFG_TTL = 5 * 60e3;
const CAMPAIGN_DAYS = 30;
const K = {
  cfg: (site: string) => `msdb:cfg:${site}`,
  campaign: 'msdb:campaign',
  campaignSeen: 'msdb:campaign-seen',
  pushSeen: 'msdb:push-seen',
  promoSeen: 'msdb:promo-seen',
  dismissed: 'msdb:promo-dismissed',
};

const today = () => new Date().toISOString().slice(0, 10);
const read = <T>(key: string, fallback: T): T => {
  try { return (JSON.parse(localStorage.getItem(key) || 'null') as T) ?? fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };

/* ------------------------------------------------------------ counting */

function mayCount() {
  try {
    const n = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (n.globalPrivacyControl || n.doNotTrack === '1') return false;
    return /(^|\.)msdevbuild\.com$/.test(location.hostname);
  } catch { return false; }
}

/** Add 1 to {path}.n. keepalive so a click that navigates away still lands. */
function bump(path: string) {
  if (!mayCount()) return;
  const name = `projects/${FIREBASE.projectId}/databases/(default)/documents/${path}`;
  void fetch(`${FIRESTORE_REST}:commit`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{ transform: { document: name, fieldTransforms: [{ fieldPath: 'n', increment: { integerValue: '1' } }] } }] }),
  }).catch(() => { /* a missed count is fine */ });
}

/* ----------------------------------------------------------- campaigns */

/**
 * The campaign this browser arrived through in the last 30 days, or ''.
 * Forms send it as `campaign`; the rules only accept real campaign names, so a
 * form must retry without it if the write is refused (see the blog's writers).
 */
export function currentCampaign(): string {
  if (typeof window === 'undefined') return '';
  const c = read<{ c?: string; at?: number } | null>(K.campaign, null);
  if (!c?.c || !SLUG.test(c.c) || !c.at || Date.now() - c.at > CAMPAIGN_DAYS * 864e5) return '';
  return c.c;
}

function captureLanding() {
  const params = new URLSearchParams(location.search);
  const campaign = (params.get('utm_campaign') || '').toLowerCase();
  if (SLUG.test(campaign)) {
    write(K.campaign, { c: campaign, at: Date.now() });
    const seen = read<Record<string, string>>(K.campaignSeen, {});
    if (seen[campaign] !== today()) {
      bump(`campaignVisits/${campaign}__${today()}`);
      seen[campaign] = today();
      write(K.campaignSeen, seen);
    }
  }
  const pn = params.get('pn') || '';
  if (PUSH_ID.test(pn)) {
    const seen = read<string[]>(K.pushSeen, []);
    if (!seen.includes(pn)) { bump(`pushClicks/${pn}`); write(K.pushSeen, [...seen, pn].slice(-50)); }
    // Tidy the address bar; utm_* stays for Google Analytics.
    params.delete('pn');
    const qs = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
}

/* -------------------------------------------------------------- config */

/** Hide every [data-msdb-feature="key"] whose switch is off. Runs before paint from the cache. */
export function applyFeatures(cfg: SiteConfig | null) {
  const off = Object.entries(cfg?.features ?? {}).filter(([, on]) => on === false).map(([k]) => k);
  document.documentElement.dataset.msdbOff = off.join(' ');
  let style = document.getElementById('msdb-off');
  if (!style) { style = document.createElement('style'); style.id = 'msdb-off'; document.head.append(style); }
  style.textContent = off.map((k) => `[data-msdb-feature="${CSS.escape(k)}"]{display:none!important}`).join('');
}

/** True unless the portal switched this feature off. Components call it before opening anything. */
export function featureOn(key: string) {
  return !(document.documentElement.dataset.msdbOff || '').split(' ').includes(key);
}

async function loadConfig(site: string): Promise<SiteConfig | null> {
  const cached = read<{ at: number; cfg: SiteConfig } | null>(K.cfg(site), null);
  if (cached && Date.now() - cached.at < CFG_TTL) return cached.cfg;
  try {
    const res = await fetch(`${FIRESTORE_REST}/siteConfig/${encodeURIComponent(site)}`);
    if (res.status === 404) { write(K.cfg(site), { at: Date.now(), cfg: null }); return null; }
    if (!res.ok) return cached?.cfg ?? null;
    const doc = await res.json();
    const cfg = JSON.parse(doc?.fields?.json?.stringValue || 'null') as SiteConfig | null;
    write(K.cfg(site), { at: Date.now(), cfg });
    return cfg;
  } catch { return cached?.cfg ?? null; }
}

/* ---------------------------------------------------------- promotions */

const onPage = (p: Promo) => !p.paths?.length || p.paths.some((x) => location.pathname === x || location.pathname.startsWith(x.endsWith('/') ? x : `${x}/`));
const inWindow = (p: Promo, now = Date.now()) => (!p.startAt || +new Date(p.startAt) <= now) && (!p.endAt || +new Date(p.endAt) > now);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeUrl = (u: string) => (/^(\/(?!\/)|https:\/\/)/.test(u) ? u : '');

function seenToday(id: string) {
  const seen = read<Record<string, string>>(K.promoSeen, {});
  if (seen[id] === today()) return;
  seen[id] = today();
  // Keep the map small: only today's entries matter.
  write(K.promoSeen, Object.fromEntries(Object.entries(seen).filter(([, d]) => d === today())));
  bump(`promoStats/${id}__${today()}__view`);
}

const dismissed = () => read<string[]>(K.dismissed, []);
const dismiss = (id: string) => write(K.dismissed, [...dismissed(), id].slice(-100));

function button(p: Promo) {
  const url = safeUrl(p.url);
  if (!p.cta || !url) return '';
  const external = url.startsWith('https://') && !url.startsWith(location.origin);
  return `<a class="msdb-cta" href="${esc(url)}" data-msdb-click="${esc(p.id)}"${external ? ' target="_blank" rel="noopener"' : ''}>${esc(p.cta)}</a>`;
}

function renderBar(p: Promo) {
  document.querySelector('.msdb-bar')?.remove();
  const bar = document.createElement('div');
  bar.className = `msdb-bar msdb-${p.tone}`;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Announcement');
  bar.innerHTML = `<p><span>${esc(p.text)}</span>${button(p)}</p><button type="button" class="msdb-x" aria-label="Dismiss announcement">×</button>`;
  bar.querySelector('.msdb-x')!.addEventListener('click', () => { dismiss(p.id); bar.remove(); });
  // Right where <SiteEngage> sits (after the skip link), else the top of the page.
  const anchor = document.getElementById('msdb-engage');
  if (anchor) anchor.after(bar); else document.body.prepend(bar);
  seenToday(p.id);
}

let popupTimer = 0;
function renderPopup(p: Promo) {
  clearTimeout(popupTimer);
  document.querySelector('.msdb-pop')?.remove();
  popupTimer = window.setTimeout(() => {
    // Never on top of another dialog (newsletter, install sheet, sign-in).
    if (document.querySelector('dialog[open]') || !onPage(p) || dismissed().includes(p.id)) return;
    const box = document.createElement('aside');
    box.className = `msdb-pop msdb-pop-${p.tone}`;
    box.setAttribute('aria-labelledby', `msdb-pop-${p.id}`);
    box.innerHTML = `<button type="button" class="msdb-x" aria-label="Close">×</button>
      <p class="msdb-pop-title" id="msdb-pop-${esc(p.id)}">${esc(p.title)}</p><p>${esc(p.text)}</p>${button(p)}`;
    const close = () => { dismiss(p.id); box.remove(); };
    box.querySelector('.msdb-x')!.addEventListener('click', close);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    box.querySelector('[data-msdb-click]')?.addEventListener('click', () => dismiss(p.id));
    document.body.append(box);
    seenToday(p.id);
  }, 6000);
}

function renderFeatured(cfg: SiteConfig | null) {
  document.querySelectorAll<HTMLElement>('[data-msdb-featured]').forEach((slot) => {
    const f = cfg?.featured;
    const url = f ? safeUrl(f.url) : '';
    if (!f || !url) { slot.hidden = true; slot.innerHTML = ''; return; }
    slot.hidden = false;
    slot.innerHTML = `<a class="msdb-featured" href="${esc(url)}" data-msdb-click="">
      <span class="msdb-featured-label">${esc(f.label)}</span><span class="msdb-featured-title">${esc(f.title)}</span>${f.text ? `<span class="msdb-featured-text">${esc(f.text)}</span>` : ''}</a>`;
  });
}

function render(cfg: SiteConfig | null) {
  applyFeatures(cfg);
  renderFeatured(cfg);
  const live = (cfg?.promos ?? []).filter((p) => inWindow(p) && onPage(p) && !dismissed().includes(p.id));
  const bar = live.find((p) => p.kind === 'bar');
  if (bar) renderBar(bar); else document.querySelector('.msdb-bar')?.remove();
  const pop = live.find((p) => p.kind === 'popup');
  if (pop) renderPopup(pop); else { clearTimeout(popupTimer); document.querySelector('.msdb-pop')?.remove(); }
}

/* --------------------------------------------------------------- start */

let wired = false;

/** Call on every page load (Astro view transitions included). Idempotent. */
export async function run(site: string) {
  captureLanding();
  render(read<{ cfg: SiteConfig } | null>(K.cfg(site), null)?.cfg ?? null);
  render(await loadConfig(site));
  if (!wired) {
    wired = true;
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-msdb-click]');
      if (a?.dataset.msdbClick) bump(`promoStats/${a.dataset.msdbClick}__${today()}__click`);
    });
  }
}
