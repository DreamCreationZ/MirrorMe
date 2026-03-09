"use client";

import { collection, getDocs, orderBy, query, setDoc, doc } from "firebase/firestore";
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

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  localStore.setProfile(userId, profile);

  if (!firebaseReady() || !db) return;

  void setDoc(doc(db, "users", userId), profile, { merge: true }).catch(() => undefined);
}

export async function loadProfile(userId: string): Promise<UserProfile | null> {
  return localStore.getProfile(userId);
}

export async function addClosetItem(userId: string, item: ClosetItem): Promise<void> {
  const current = localStore.getCloset(userId);
  const duplicate = current.find((x) => closetKey(x) === closetKey(item));
  if (duplicate) return;
  localStore.setCloset(userId, [item, ...current]);

  if (!firebaseReady() || !db) return;

  void setDoc(doc(db, "users", userId, "closet", item.id), item, { merge: true }).catch(() => undefined);
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
