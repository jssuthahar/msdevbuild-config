/**
 * Live activity and the bell, for every MSDEVBUILD site.
 *
 * Presence (who is here, from where) uses the blog's proven design, now
 * site-wide and on every page:
 *   presenceMinutes/{id}  counts per country for one clock minute
 *   presenceDays/{id}     counts per country for one day (once per session)
 * where id is the UTC key (YYYYMMDDHHmm / YYYYMMDD), prefixed "<site>-" for
 * every site but the blog, whose buckets predate the others.
 *
 * A visible tab adds 1 to the current minute and reads the previous, complete
 * minute: one write and one read per visitor per minute whatever the traffic.
 * The 10-day figures are 10 reads, cached for an hour. Countries come from the
 * browser's timezone (./country.ts): no IP, no cookie, nothing personal.
 *
 * The bell lists announcements from siteConfig/{site} (published by
 * admin.msdevbuild.com), which <SiteEngage> already loads, so it costs nothing
 * extra. Unread = newer than the last time this browser opened the bell.
 */
import { FIREBASE, FIRESTORE_REST } from './firebase';
import { countryFromTimeZone, flagOf, nameOf } from './country';
import { mayCount, type Announcement, type SiteConfig } from './engage';

const pad = (n: number) => String(n).padStart(2, '0');
const minuteKey = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
const dayKey = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const bucket = (site: string, key: string) => (site === 'blog' ? key : `${site}-${key}`);
const DAYS = 10;

let CC: string | null = null;
try { CC = countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* old browser */ }

type Counts = Record<string, number>;

function countsOf(doc: any): Counts {
  const f = doc?.fields?.counts?.mapValue?.fields;
  const out: Counts = {};
  if (f) for (const [k, v] of Object.entries(f)) out[k] = Number((v as { integerValue?: string }).integerValue || 0);
  return out;
}

async function getDoc(collection: string, id: string) {
  try { const r = await fetch(`${FIRESTORE_REST}/${collection}/${id}`); return r.ok ? await r.json() : null; } catch { return null; }
}

/** counts.<country> += 1, same write shape as the blog's presence counter (the rules allow one country per write). */
function bumpCountry(collection: string, id: string) {
  if (!CC || !mayCount()) return;
  void fetch(`${FIRESTORE_REST}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{
      update: { name: `projects/${FIREBASE.projectId}/databases/(default)/documents/${collection}/${id}`, fields: {} },
      updateMask: { fieldPaths: [] },
      updateTransforms: [{ fieldPath: `counts.${CC}`, increment: { integerValue: '1' } }],
    }] }),
  }).catch(() => {});
}

const sorted = (c: Counts) => Object.entries(c).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ data */

export interface Live { total: number; countries: [string, number][] }
export interface Recent { total: number; countries: [string, number][]; days: { day: string; n: number }[] }

let live: Live = { total: 0, countries: [] };
let recent: Recent | null = null;

async function readLive(site: string) {
  const counts = countsOf(await getDoc('presenceMinutes', bucket(site, minuteKey(new Date(Date.now() - 60_000)))));
  live = { total: sum(counts), countries: sorted(counts) };
}

async function readRecent(site: string) {
  const key = `msdb:recent:${site}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.at < 3_600_000) { recent = c.recent; return; }
  } catch { /* blocked */ }
  const days = Array.from({ length: DAYS }, (_, i) => dayKey(new Date(Date.now() - (DAYS - 1 - i) * 864e5)));
  const docs = await Promise.all(days.map((d) => getDoc('presenceDays', bucket(site, d))));
  const totals: Counts = {};
  const perDay = docs.map((doc, i) => {
    const c = countsOf(doc);
    for (const [k, n] of Object.entries(c)) totals[k] = (totals[k] || 0) + n;
    return { day: days[i], n: sum(c) };
  });
  recent = { total: sum(totals), countries: sorted(totals), days: perDay };
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), recent })); } catch { /* blocked */ }
}

/* --------------------------------------------------------------- painting */

const flags = (list: [string, number][], max = 6) => list.slice(0, max).map(([c]) => flagOf(c)).join(' ');

function paintLive() {
  const signedIn = document.documentElement.dataset.auth === 'in';
  // Inline strips (<SiteLive />): live count for everyone; the 10-day line for visitors who are not signed in.
  document.querySelectorAll<HTMLElement>('[data-msdb-live]').forEach((el) => {
    const parts: string[] = [];
    if (live.total) parts.push(`<span class="msdb-live-dot" aria-hidden="true"></span><b>${plural(live.total, 'person', 'people')} online now</b>${live.countries.length ? ` <span class="msdb-flags" title="${esc(live.countries.map(([c, n]) => `${nameOf(c)} ${n}`).join(', '))}">${flags(live.countries)}</span>` : ''}`);
    if (!signedIn && recent?.total) parts.push(`${plural(recent.total, 'visitor', 'visitors')} from ${plural(recent.countries.length, 'country', 'countries')} in the last ${DAYS} days <span class="msdb-flags">${flags(recent.countries, 8)}</span>`);
    el.innerHTML = parts.join('<span class="msdb-sep" aria-hidden="true">·</span>');
    el.hidden = !parts.length;
  });
  // The bell: a green dot while anyone else is here, and the Live tab.
  document.querySelectorAll<HTMLElement>('[data-msdb-bell]').forEach((bell) => {
    bell.querySelector<HTMLElement>('.msdb-bell-on')!.hidden = !live.total;
    const now = bell.querySelector<HTMLElement>('[data-bell-live]');
    if (now) now.innerHTML = live.total
      ? `<p class="msdb-bell-big"><span class="msdb-live-dot" aria-hidden="true"></span>${plural(live.total, 'person', 'people')} online now</p>
         <ul class="msdb-countries">${live.countries.map(([c, n]) => `<li><span>${flagOf(c)} ${esc(nameOf(c))}</span><b>${n}</b></li>`).join('')}</ul>`
      : '<p class="msdb-bell-muted">Counting who is online… (updates every minute)</p>';
    const days = bell.querySelector<HTMLElement>('[data-bell-days]');
    if (days && recent) {
      const max = Math.max(1, ...recent.days.map((d) => d.n));
      days.innerHTML = recent.total ? `
        <p class="msdb-bell-big">${plural(recent.total, 'visitor', 'visitors')} · ${plural(recent.countries.length, 'country', 'countries')}</p>
        <p class="msdb-bell-muted">Last ${DAYS} days</p>
        <div class="msdb-days" role="img" aria-label="${esc(recent.days.map((d) => `${d.day.slice(6)}/${d.day.slice(4, 6)}: ${d.n}`).join(', '))}">${recent.days.map((d) => `<i style="height:${Math.max(4, (d.n / max) * 100)}%" title="${d.n}"></i>`).join('')}</div>
        <ul class="msdb-countries">${recent.countries.slice(0, 12).map(([c, n]) => `<li><span>${flagOf(c)} ${esc(nameOf(c))}</span><b>${n}</b></li>`).join('')}</ul>
        ${recent.countries.length > 12 ? `<p class="msdb-bell-muted">+${recent.countries.length - 12} more countries</p>` : ''}` : '<p class="msdb-bell-muted">No visits recorded yet.</p>';
    }
  });
}

const seenKey = (site: string) => `msdb:bell-seen:${site}`;
const ago = (iso: string) => {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const safeUrl = (u: string) => (/^(\/(?!\/)|https:\/\/)/.test(u) ? u : '');

function paintBell(site: string, list: Announcement[]) {
  let seen = '';
  try { seen = localStorage.getItem(seenKey(site)) || ''; } catch { /* blocked */ }
  // First visit: the last two weeks count as new, so a newcomer sees what is going on.
  const since = seen || new Date(Date.now() - 14 * 864e5).toISOString();
  const unread = list.filter((a) => a.at > since).length;
  document.querySelectorAll<HTMLElement>('[data-msdb-bell]').forEach((bell) => {
    const badge = bell.querySelector<HTMLElement>('.msdb-bell-badge')!;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = !unread;
    bell.querySelector('.msdb-bell-btn')!.setAttribute('aria-label', unread ? `Updates: ${unread} new` : 'Updates and who is online');
    const ul = bell.querySelector<HTMLElement>('[data-bell-list]')!;
    ul.innerHTML = list.length ? list.map((a) => {
      const url = safeUrl(a.url);
      const inner = `<span class="msdb-bell-title">${a.at > since ? '<i class="msdb-new" aria-label="New"></i>' : ''}${esc(a.title)}</span>${a.body ? `<span class="msdb-bell-body">${esc(a.body)}</span>` : ''}<span class="msdb-bell-time">${esc(ago(a.at))}</span>`;
      return `<li>${url ? `<a href="${esc(url)}" data-bell-item="${esc(a.id)}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
    }).join('') : '<li class="msdb-bell-muted">No announcements yet. New articles, events and courses show up here.</li>';
  });
}

/* ------------------------------------------------------------------ wiring */

let timer = 0;
let currentSite = '';
let wired = false;

function heartbeat() {
  if (document.visibilityState !== 'visible' || !currentSite) return;
  bumpCountry('presenceMinutes', bucket(currentSite, minuteKey(new Date())));
  void readLive(currentSite).then(paintLive);
}

function bindBell() {
  document.querySelectorAll<HTMLElement>('[data-msdb-bell]:not([data-bound])').forEach((bell) => {
    bell.dataset.bound = '';
    const btn = bell.querySelector<HTMLButtonElement>('.msdb-bell-btn')!;
    const panel = bell.querySelector<HTMLElement>('.msdb-bell-panel')!;
    const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) {
        try { localStorage.setItem(seenKey(currentSite), new Date().toISOString()); } catch { /* blocked */ }
        // Badge clears, but the "new" marks stay until the next open so they can be read.
        bell.querySelector<HTMLElement>('.msdb-bell-badge')!.hidden = true;
        void readRecent(currentSite).then(paintLive);
      }
    });
    bell.querySelectorAll<HTMLButtonElement>('[data-bell-tab]').forEach((tab) => tab.addEventListener('click', () => {
      bell.querySelectorAll<HTMLButtonElement>('[data-bell-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      bell.querySelectorAll<HTMLElement>('[data-bell-pane]').forEach((p) => { p.hidden = p.dataset.bellPane !== tab.dataset.bellTab; });
    }));
    document.addEventListener('click', (e) => { if (!panel.hidden && !bell.contains(e.target as Node)) close(); });
    bell.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); } });
  });
}

/** Call on every page (view transitions included). */
export function startActivity(site: string) {
  currentSite = site;
  bindBell();
  const cfg = (window as unknown as { __msdbConfig?: SiteConfig | null }).__msdbConfig;
  if (cfg !== undefined) paintBell(site, cfg?.announcements ?? []);
  // Readers, not minutes: the day bucket is counted once per browser session.
  try {
    const k = `msdb:day:${site}:${dayKey(new Date())}`;
    if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); bumpCountry('presenceDays', bucket(site, dayKey(new Date()))); }
  } catch { /* blocked */ }
  if (!timer) { heartbeat(); timer = window.setInterval(heartbeat, 60_000); } else { paintLive(); }
  void readRecent(site).then(paintLive);
  if (!wired) {
    wired = true;
    document.addEventListener('msdb:config', (e) => paintBell(currentSite, (e as CustomEvent<SiteConfig | null>).detail?.announcements ?? []));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') heartbeat(); });
    addEventListener('msdb-auth', paintLive);
  }
}
