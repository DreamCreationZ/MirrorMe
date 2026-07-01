const randomBetween = (min, max) => Math.random() * (max - min) + min;

export class SimulatedMarketData {
  constructor(symbols) {
    this.state = new Map();
    for (const symbol of symbols) {
      this.state.set(symbol, randomBetween(100, 2500));
    }
  }

  async getLatestPrice(symbol) {
    const previous = this.state.get(symbol) ?? randomBetween(100, 2500);
    const driftPct = randomBetween(-0.7, 0.9);
    const next = Math.max(1, previous * (1 + driftPct / 100));
    this.state.set(symbol, next);
    return Number(next.toFixed(2));
  }
}
