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
  if (!auth || persistenceInitialized) return;
  await setPersistence(auth, browserLocalPersistence);
  persistenceInitialized = true;
}

export function getCurrentUser(): AuthUser | null {
  if (!auth) return null;
  return mapUser(auth.currentUser);
}

export async function waitForAuthInit(): Promise<AuthUser | null> {
  if (!auth) return null;

  return new Promise((resolve) => {
    const unsubscribe = firebaseOnAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(mapUser(user));
    });
  });
}

export async function signup(name: string, email: string, password: string): Promise<AuthUser> {
  await ensurePersistence();
  if (!auth) throw new Error("Firebase auth unavailable.");

  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) {
    await updateProfile(result.user, { displayName: name.trim() });
  }

  const mapped = mapUser(result.user);
  if (!mapped) throw new Error("Failed to create account.");
  return { ...mapped, name: name.trim() || mapped.name };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  await ensurePersistence();
  if (!auth) throw new Error("Firebase auth unavailable.");

  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  const mapped = mapUser(result.user);
  if (!mapped) throw new Error("Login failed.");
  return mapped;
}

export async function logout(): Promise<void> {
  ensureFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }

  const unsubscribe = firebaseOnAuthStateChanged(auth, (user) => {
    callback(mapUser(user));
  });

  return unsubscribe;
}
