"use client";

export function LuxShowcase() {
  return (
    <section className="lux-stage">
      <div className="lux-phone-grid">
        <article className="lux-phone">
          <h4>What&apos;s the Occasion?</h4>
          <div className="lux-tile-grid">
            <button className="lux-tile"><span>💼</span>Work</button>
            <button className="lux-tile"><span>👕</span>Casual</button>
            <button className="lux-tile"><span>❤️</span>Date Night</button>
            <button className="lux-tile"><span>🤵</span>Formal</button>
            <button className="lux-tile"><span>🎉</span>Festival</button>
            <button className="lux-tile"><span>✨</span>Custom</button>
          </div>
          <button className="lux-footer">Continue</button>
        </article>

        <article className="lux-phone">
          <h4>Choose Your Outfit</h4>
          <div className="lux-shelf">
            <span>👔 Tops</span>
            <div className="lux-chip-row"><i /> <i /> <i /> <i /></div>
          </div>
          <div className="lux-shelf">
            <span>👖 Bottoms</span>
            <div className="lux-chip-row"><i /> <i /> <i /> <i /></div>
          </div>
          <div className="lux-shelf">
            <span>👞 Shoes</span>
            <div className="lux-chip-row"><i /> <i /> <i /> <i /></div>
          </div>
          <div className="lux-shelf">
            <span>⌚ Accessories</span>
            <div className="lux-chip-row"><i /> <i /> <i /> <i /></div>
          </div>
        </article>

        <article className="lux-phone">
          <h4>Today&apos;s Pick</h4>
          <div className="lux-model-card">
            <div className="lux-model-silhouette" />
            <p>Elegant fit for your day</p>
          </div>
          <div className="lux-actions">
            <button className="secondary">Change Top</button>
            <button className="secondary">Change Bottom</button>
          </div>
        </article>

        <article className="lux-phone">
          <h4>Virtual Try-On</h4>
          <div className="lux-mirror">
            <div className="lux-model-silhouette strong" />
          </div>
          <div className="lux-actions">
            <button className="secondary">Adjust Fit</button>
            <button className="secondary">Confirm</button>
          </div>
        </article>
      </div>
    </section>
  );
}
