"use client";

import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User as FirebaseUser
} from "firebase/auth";
import { auth, firebaseReady } from "@/lib/firebase";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

let persistenceInitialized = false;

function mapUser(user: FirebaseUser | null): AuthUser | null {
  if (!user || !user.email) return null;

  const createdAt = user.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : Date.now();

  return {
    id: user.uid,
    email: user.email,
    name: user.displayName || user.email.split("@")[0],
    createdAt
  };
}

function ensureFirebaseAuth() {
  if (!firebaseReady() || !auth) {
    throw new Error("Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* values in .env.local.");
  }
}

async function ensurePersistence() {
  ensureFirebaseAuth();
  const firebaseAuth = auth;
  if (!firebaseAuth || persistenceInitialized) return;
  await setPersistence(firebaseAuth, browserLocalPersistence);
  persistenceInitialized = true;
}

export function getCurrentUser(): AuthUser | null {
  if (!auth) return null;
  return mapUser(auth.currentUser);
}

export async function waitForAuthInit(): Promise<AuthUser | null> {
  const firebaseAuth = auth;
  if (!firebaseAuth) return null;

  return new Promise((resolve) => {
    const unsubscribe = firebaseOnAuthStateChanged(firebaseAuth, (user) => {
      unsubscribe();
      resolve(mapUser(user));
    });
  });
}

export async function signup(name: string, email: string, password: string): Promise<AuthUser> {
  await ensurePersistence();
  const firebaseAuth = auth;
  if (!firebaseAuth) throw new Error("Firebase auth unavailable.");

  const result = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
  if (name.trim()) {
    await updateProfile(result.user, { displayName: name.trim() });
  }

  const mapped = mapUser(result.user);
  if (!mapped) throw new Error("Failed to create account.");
  return { ...mapped, name: name.trim() || mapped.name };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  await ensurePersistence();
  const firebaseAuth = auth;
  if (!firebaseAuth) throw new Error("Firebase auth unavailable.");

  const result = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  const mapped = mapUser(result.user);
  if (!mapped) throw new Error("Login failed.");
  return mapped;
}

export async function logout(): Promise<void> {
  ensureFirebaseAuth();
  const firebaseAuth = auth;
  if (!firebaseAuth) return;
  await signOut(firebaseAuth);
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  const firebaseAuth = auth;
  if (!firebaseAuth) {
    callback(null);
    return () => {};
  }

  const unsubscribe = firebaseOnAuthStateChanged(firebaseAuth, (user) => {
    callback(mapUser(user));
  });

  return unsubscribe;
}
