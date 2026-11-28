#!/usr/bin/env node
/**
 * Self-hosted Firebase Auth helper for an MSDEVBUILD site, so Google's sign-in
 * names the site's own domain instead of msdevbuild-azure.firebaseapp.com.
 * (Google shows the *app name*, MSDEVBUILD, only once the OAuth brand is
 * verified in Google Cloud → Google Auth Platform → Branding; until then it
 * shows a domain, and this makes it ours.)
 * https://firebase.google.com/docs/auth/web/redirect-best-practices (option 4)
 *
 *   node node_modules/@msdevbuild/config/scripts/auth-helper.mjs --host blog.msdevbuild.com
 *       copies Firebase's handler into public/__/auth/ and writes
 *       public/__/firebase/init.json. Re-run every few months.
 *   ... --init-only
 *       only init.json, e.g. as `prebuild`, so a site that keeps its API key
 *       out of git (the blog) writes it at build time from the environment.
 *
 * API key: --api-key, else FIREBASE_API_KEY / PUBLIC_FIREBASE_API_KEY. It is a
 * public identifier (restricted by HTTP referrer), but a site may still prefer
 * not to commit it; git-ignore public/__/firebase/init.json then.
 *
 * Each host also needs https://<host>/__/auth/handler as an authorised redirect
 * URI on the OAuth web client (Google Cloud → Credentials), and <host> in
 * Firebase → Authentication → Authorised domains.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

// Kept in step with src/firebase.ts (this runs in plain Node, so it can't import it).
const FIREBASE = {
  authDomain: 'msdevbuild-azure.firebaseapp.com',
  projectId: 'msdevbuild-azure',
  storageBucket: 'msdevbuild-azure.firebasestorage.app',
  messagingSenderId: '716410365766',
  appId: '1:716410365766:web:2bef18ffc01314eb51a747',
};

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const host = arg('host');
const apiKey = arg('api-key') || process.env.FIREBASE_API_KEY || process.env.PUBLIC_FIREBASE_API_KEY || '';
const root = arg('public') || 'public';
if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) { console.error('✗ --host <your.site.domain> is required'); process.exit(1); }

if (!args.includes('--init-only')) {
  const out = `${root}/__/auth`;
  mkdirSync(out, { recursive: true });
  const files = { handler: 'handler.html', 'handler.js': 'handler.js', 'experiments.js': 'experiments.js', iframe: 'iframe.html', 'iframe.js': 'iframe.js' };
  for (const [src, dest] of Object.entries(files)) {
    const r = await fetch(`https://${FIREBASE.authDomain}/__/auth/${src}`);
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    const body = await r.text();
    writeFileSync(`${out}/${dest}`, body);
    console.log(`✓ ${out}/${dest} (${body.length.toLocaleString()} bytes)`);
  }
}

mkdirSync(`${root}/__/firebase`, { recursive: true });
if (!apiKey) {
  // No key (a local build without .env): skip, and sign-in falls back to firebaseapp.com.
  console.warn('! no API key (FIREBASE_API_KEY / PUBLIC_FIREBASE_API_KEY): public/__/firebase/init.json not written');
} else {
  writeFileSync(`${root}/__/firebase/init.json`, JSON.stringify({ apiKey, ...FIREBASE, authDomain: host }, null, 2) + '\n');
  console.log(`✓ ${root}/__/firebase/init.json (authDomain ${host})`);
}
