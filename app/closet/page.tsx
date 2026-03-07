"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { addClosetItem, loadCloset } from "@/lib/persistence";
import { ClosetItem } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function ClosetPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [form, setForm] = useState({
    category: "top" as ClosetItem["category"],
    name: "",
    color: "",
    brand: "",
    tags: "",
    imageUrl: ""
  });

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      const loaded = await loadCloset(user.id);
      setItems(loaded);
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    const payload: ClosetItem = {
      id: uid(),
      category: form.category,
      name: form.name,
      color: form.color,
      brand: form.brand || undefined,
      imageUrl: form.imageUrl || undefined,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: Date.now()
    };

    if (!userId) return;

    await addClosetItem(userId, payload);
    setItems((prev) => [payload, ...prev]);
    setForm((f) => ({ ...f, name: "", color: "", brand: "", tags: "", imageUrl: "" }));
  }

  return (
    <section className="grid cols-2">
      <article className="card">
        <h2>Add Closet Item</h2>
        <form onSubmit={onSubmit}>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ClosetItem["category"] }))}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="dress">Dress</option>
              <option value="outerwear">Outerwear</option>
              <option value="shoes">Shoes</option>
              <option value="sandal">Sandal</option>
              <option value="accessory">Accessory</option>
            </select>
          </label>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </label>
          <label>
            Color
            <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} required />
          </label>
          <label>
            Brand
            <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
          </label>
          <label>
            Tags (comma separated)
            <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </label>
          <label>
            Image URL (optional)
            <input value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
          </label>
          <button type="submit">Add Item</button>
          <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => router.push("/occasion")}>
            Skip for Now
          </button>
        </form>
      </article>

      <article className="card">
        <h2>Your Closet ({items.length})</h2>
        <div className="grid">
          {items.map((item) => (
            <div key={item.id} style={{ border: "1px solid #e7d4be", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{item.name}</strong>
                <span className="badge">{item.category}</span>
              </div>
              <p className="small" style={{ marginBottom: 6 }}>{item.color}{item.brand ? ` · ${item.brand}` : ""}</p>
              <p className="small">{item.tags.join(", ") || "No tags"}</p>
            </div>
          ))}
          {!items.length ? <p className="small">No items yet.</p> : null}
        </div>
      </article>
    </section>
  );
}
