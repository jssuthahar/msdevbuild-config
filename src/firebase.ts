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
 */
export const FIREBASE = {
  apiKey: 'AIzaSyAUkdCvWJ-1_IaIe_PHa7xqqy3ZBDtGd4Q',
  authDomain: 'msdevbuild-azure.firebaseapp.com',
  projectId: 'msdevbuild-azure',
  storageBucket: 'msdevbuild-azure.firebasestorage.app',
  messagingSenderId: '716410365766',
  appId: '1:716410365766:web:2bef18ffc01314eb51a747',
} as const;

/** Firestore REST base for the shared project. */
export const FIRESTORE_REST = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
