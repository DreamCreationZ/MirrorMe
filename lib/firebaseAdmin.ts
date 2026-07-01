import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type AdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readConfig(): AdminConfig | null {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || "";
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || "";
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim() || "";
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

let initialized = false;

function ensureAdminApp() {
  const config = readConfig();
  if (!config) return null;

  if (getApps().length) {
    initialized = true;
    return getApp();
  }

  const app = initializeApp({
    credential: cert({
      projectId: config.projectId,
      clientEmail: config.clientEmail,
      privateKey: config.privateKey
    })
  });
  initialized = true;
  return app;
}

export function firebaseAdminReady() {
  return Boolean(readConfig());
}

export function getAdminAuth() {
  const app = ensureAdminApp();
  if (!app) return null;
  return getAuth(app);
}

export function getAdminDb() {
  const app = ensureAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

export function adminInitialized() {
  return initialized;
}
