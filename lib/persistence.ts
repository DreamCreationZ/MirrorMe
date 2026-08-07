"use client";

import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc } from "firebase/firestore";
import { db, firebaseReady } from "@/lib/firebase";
import { localStore } from "@/lib/localStore";
import { ClosetItem, UserProfile } from "@/types/models";

function closetKey(item: ClosetItem) {
  return `${item.category}|${(item.name || "").trim().toLowerCase()}|${(item.imageUrl || "").trim()}`;
}

function dedupeCloset(items: ClosetItem[]) {
  const seen = new Set<string>();
  const deduped: ClosetItem[] = [];
  for (const item of items) {
    const key = closetKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function saveProfileLocal(userId: string, profile: UserProfile): void {
  localStore.setProfile(userId, profile);
}

export async function syncProfileToCloud(userId: string, profile: UserProfile): Promise<void> {
  if (!firebaseReady() || !db) return;
  await setDoc(doc(db, "users", userId), profile, { merge: true });
}

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  saveProfileLocal(userId, profile);
  void syncProfileToCloud(userId, profile).catch(() => undefined);
}

export async function loadProfile(userId: string): Promise<UserProfile | null> {
  const localProfile = localStore.getProfile(userId);
  if (localProfile) {
    return localProfile;
  }

  if (!firebaseReady() || !db) return null;

  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) return null;
    const remoteProfile = snap.data() as UserProfile;
    localStore.setProfile(userId, remoteProfile);
    return remoteProfile;
  } catch {
    return null;
  }
}

export async function addClosetItem(userId: string, item: ClosetItem): Promise<void> {
  const current = localStore.getCloset(userId);
  const duplicate = current.find((x) => closetKey(x) === closetKey(item));
  if (duplicate) return;
  localStore.setCloset(userId, [item, ...current]);

  if (!firebaseReady() || !db) return;

  void setDoc(doc(db, "users", userId, "closet", item.id), item, { merge: true }).catch(() => undefined);
}

export async function updateClosetItem(userId: string, itemId: string, updates: Partial<ClosetItem>): Promise<ClosetItem | null> {
  const current = localStore.getCloset(userId);
  const prev = current.find((item) => item.id === itemId);
  if (!prev) return null;

  const next: ClosetItem = {
    ...prev,
    ...updates,
    id: prev.id,
    createdAt: prev.createdAt
  };

  const merged = current.map((item) => (item.id === itemId ? next : item));
  localStore.setCloset(userId, merged);

  if (firebaseReady() && db) {
    void setDoc(doc(db, "users", userId, "closet", itemId), next, { merge: true }).catch(() => undefined);
  }

  return next;
}

export async function deleteClosetItem(userId: string, itemId: string): Promise<void> {
  const current = localStore.getCloset(userId);
  const next = current.filter((item) => item.id !== itemId);
  localStore.setCloset(userId, next);

  if (!firebaseReady() || !db) return;
  void deleteDoc(doc(db, "users", userId, "closet", itemId)).catch(() => undefined);
}

export async function setClosetItemFavorite(userId: string, itemId: string, favorite: boolean): Promise<ClosetItem | null> {
  return updateClosetItem(userId, itemId, { favorite });
}

export async function loadCloset(userId: string): Promise<ClosetItem[]> {
  const local = dedupeCloset(localStore.getCloset(userId));
  localStore.setCloset(userId, local);
  if (!firebaseReady() || !db) return local;

  try {
    const q = query(collection(db, "users", userId, "closet"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) return local;

    const merged = dedupeCloset(snap.docs.map((d) => d.data() as ClosetItem));
    localStore.setCloset(userId, merged);
    return merged;
  } catch {
    return local;
  }
}

export async function markClosetItemWorn(userId: string, itemId: string): Promise<void> {
  const now = Date.now();
  const current = localStore.getCloset(userId);
  const updated = current.map((item) =>
    item.id === itemId
      ? {
          ...item,
          lastWornAt: now,
          wearCount: (item.wearCount ?? 0) + 1
        }
      : item
  );

  localStore.setCloset(userId, updated);

  if (!firebaseReady() || !db) return;

  const changed = updated.find((item) => item.id === itemId);
  if (!changed) return;

  void setDoc(doc(db, "users", userId, "closet", itemId), changed, { merge: true }).catch(() => undefined);
}
