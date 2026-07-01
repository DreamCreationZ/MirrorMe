export class PaperBroker {
  constructor(initialCapital = 100_000) {
    this.cash = initialCapital;
    this.positions = new Map();
    this.trades = [];
  }

  getPosition(symbol) {
    return this.positions.get(symbol) ?? null;
  }

  getOpenPositionsCount() {
    return this.positions.size;
  }

  getEquity(priceBySymbol = {}) {
    let markToMarket = 0;
    for (const [symbol, pos] of this.positions.entries()) {
      const mark = priceBySymbol[symbol] ?? pos.avgPrice;
      markToMarket += mark * pos.quantity;
    }
    return this.cash + markToMarket;
  }

  placeOrder({ symbol, side, quantity, price, reason }) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: "Invalid quantity" };
    }

    if (side === "BUY") {
      const cost = quantity * price;
      if (cost > this.cash) {
        return { ok: false, error: "Insufficient paper cash" };
      }

      const current = this.positions.get(symbol);
      if (current) {
        const newQty = current.quantity + quantity;
        const weightedAvg = (current.avgPrice * current.quantity + price * quantity) / newQty;
        this.positions.set(symbol, {
          ...current,
          quantity: newQty,
          avgPrice: weightedAvg,
          peakPrice: Math.max(current.peakPrice, price),
        });
      } else {
        this.positions.set(symbol, { quantity, avgPrice: price, peakPrice: price });
      }

      this.cash -= cost;
      const trade = { ts: new Date().toISOString(), symbol, side, quantity, price, reason };
      this.trades.push(trade);
      return { ok: true, trade };
    }

    if (side === "SELL") {
      const current = this.positions.get(symbol);
      if (!current || current.quantity <= 0) {
        return { ok: false, error: "No position to sell" };
      }

      const sellQty = Math.min(quantity, current.quantity);
      const proceeds = sellQty * price;
      const remaining = current.quantity - sellQty;
      if (remaining <= 0) {
        this.positions.delete(symbol);
      } else {
        this.positions.set(symbol, { ...current, quantity: remaining });
      }

      this.cash += proceeds;
      const trade = { ts: new Date().toISOString(), symbol, side, quantity: sellQty, price, reason };
      this.trades.push(trade);
      return { ok: true, trade };
    }

    return { ok: false, error: `Unsupported side: ${side}` };
  }
}
