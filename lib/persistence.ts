"use client";

import { addDoc, collection, getDocs, orderBy, query, setDoc, doc } from "firebase/firestore";
import { db, firebaseReady } from "@/lib/firebase";
import { localStore } from "@/lib/localStore";
import { ClosetItem, UserProfile } from "@/types/models";

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  localStore.setProfile(userId, profile);

  if (!firebaseReady() || !db) return;

  await setDoc(doc(db, "users", userId), profile, { merge: true });
}

export async function loadProfile(userId: string): Promise<UserProfile | null> {
  return localStore.getProfile(userId);
}

export async function addClosetItem(userId: string, item: ClosetItem): Promise<void> {
  const current = localStore.getCloset(userId);
  localStore.setCloset(userId, [item, ...current]);

  if (!firebaseReady() || !db) return;

  await addDoc(collection(db, "users", userId, "closet"), item);
}

export async function loadCloset(userId: string): Promise<ClosetItem[]> {
  const local = localStore.getCloset(userId);
  if (!firebaseReady() || !db) return local;

  try {
    const q = query(collection(db, "users", userId, "closet"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) return local;

    return snap.docs.map((d) => d.data() as ClosetItem);
  } catch {
    return local;
  }
}
