import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * Is Firebase actually configured in this build?
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a deployment built without
 * them ships a config full of `undefined`. Nothing fails at import — the failure
 * arrives much later, at sign-in, as
 * `auth/api-key-not-valid.-please-pass-a-valid-api-key.`, which reads like a
 * wrong key rather than a missing one and sends you looking in the wrong place.
 *
 * Exported so the sign-in path can skip Firebase entirely on a deployment that
 * has no Firebase config. New Operations accounts live in PostgreSQL and do not
 * need it, so such a deployment is perfectly usable — it just cannot serve Old
 * Operations logins, and should say so.
 *
 * The api key and project id only: without either, nothing works. The rest
 * degrade to specific broken features rather than a broken app.
 */
export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

// Secondary app for creating accounts without logging the admin out
const secondaryApp = getApps().find(a => a.name === 'Secondary') 
  || initializeApp(firebaseConfig, 'Secondary');
export const secondaryAuth = getAuth(secondaryApp);

export default app;
