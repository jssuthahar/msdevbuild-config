/**
 * Shared Firebase project for every MSDEVBUILD site (project msdevbuild-azure,
 * sender 716410365766): azure.msdevbuild.com, blog.msdevbuild.com and the
 * admin console.
 *
 * These are public web identifiers, not secrets. Every visitor's browser
 * receives them. What protects the data is firestore.rules (kept only in the
 * private msdevbuild-admin repo), the Authorised domains list in Firebase
 * Authentication, and the API key's HTTP-referrer restriction in Google Cloud.
 * Real secrets (service account, VAPID private key) never belong here.
 *
 * The web API key is deliberately NOT here. It is public too (it ships in every
 * page that signs in), but GitHub's secret scanner flags any `AIza…` string in
 * a public repo. Each site that needs Firebase Auth adds it locally:
 *   const FB = { ...FIREBASE, apiKey: '…' }
 * and the key itself is locked to MSDEVBUILD domains in Google Cloud →
 * Credentials (HTTP referrers + API restrictions). Firestore REST reads and
 * writes need no key at all.
 */
export const FIREBASE = {
  authDomain: 'msdevbuild-azure.firebaseapp.com',
  projectId: 'msdevbuild-azure',
  storageBucket: 'msdevbuild-azure.firebasestorage.app',
  messagingSenderId: '716410365766',
  appId: '1:716410365766:web:2bef18ffc01314eb51a747',
} as const;

/** Firestore REST base for the shared project. */
export const FIRESTORE_REST = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
