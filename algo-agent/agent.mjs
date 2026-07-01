import { evaluateSignal } from "./strategies/emaCrossStrategy.mjs";
import { calculateBuyQuantity, shouldHaltForDailyLoss } from "./risk.mjs";

export class TradingAgent {
  constructor({ cfg, broker, marketData }) {
    this.cfg = cfg;
    this.broker = broker;
    this.marketData = marketData;

    this.priceHistory = new Map();
    this.lastTradeAt = new Map();
    this.dayStartEquity = cfg.initialCapital;
    this.dayIso = new Date().toISOString().slice(0, 10);
  }

  pushPrice(symbol, price) {
    const history = this.priceHistory.get(symbol) ?? [];
    history.push(price);
    if (history.length > 500) history.shift();
    this.priceHistory.set(symbol, history);
    return history;
  }

  canTradeSymbolNow(symbol) {
    const last = this.lastTradeAt.get(symbol);
    if (!last) return true;
    return Date.now() - last >= this.cfg.cooldownMs;
  }

  stampTrade(symbol) {
    this.lastTradeAt.set(symbol, Date.now());
  }

  rotateDayIfNeeded(currentEquity) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dayIso) {
      this.dayIso = today;
      this.dayStartEquity = currentEquity;
      console.log(`[AGENT] New day reset. dayStartEquity=${currentEquity.toFixed(2)}`);
    }
  }

  async tick() {
    const priceBySymbol = {};
    for (const symbol of this.cfg.symbols) {
      priceBySymbol[symbol] = await this.marketData.getLatestPrice(symbol);
    }

    const equity = this.broker.getEquity(priceBySymbol);
    this.rotateDayIfNeeded(equity);

    const halt = shouldHaltForDailyLoss({
      dayStartEquity: this.dayStartEquity,
      currentEquity: equity,
      maxDailyLossPct: this.cfg.maxDailyLossPct,
    });

    if (halt) {
      console.log(
        `[RISK] Daily loss limit reached. Trading halted for today. equity=${equity.toFixed(2)}`
      );
      return;
    }

    for (const symbol of this.cfg.symbols) {
      const price = priceBySymbol[symbol];
      const history = this.pushPrice(symbol, price);
      const position = this.broker.getPosition(symbol);

      if (position) {
        position.peakPrice = Math.max(position.peakPrice, price);
      }

      const signal = evaluateSignal({ prices: history, position, cfg: this.cfg });
      const headline = `[${new Date().toISOString()}] ${symbol} @ ${price.toFixed(2)} => ${signal.action}`;

      if (signal.action === "HOLD") {
        console.log(`${headline} (${signal.reason})`);
        continue;
      }

      if (!this.canTradeSymbolNow(symbol)) {
        console.log(`${headline} skipped (cooldown active)`);
        continue;
      }

      if (signal.action === "BUY") {
        if (this.broker.getOpenPositionsCount() >= this.cfg.maxOpenPositions) {
          console.log(`${headline} skipped (max open positions reached)`);
          continue;
        }

        const qty = calculateBuyQuantity({
          equity,
          price,
          stopLossPct: this.cfg.stopLossPct,
          riskPerTradePct: this.cfg.riskPerTradePct,
        });

        if (qty <= 0) {
          console.log(`${headline} skipped (position size = 0)`);
          continue;
        }

        const res = this.broker.placeOrder({
          symbol,
          side: "BUY",
          quantity: qty,
          price,
          reason: signal.reason,
        });

        if (res.ok) {
          this.stampTrade(symbol);
          console.log(`[TRADE] BUY ${symbol} x${qty} @ ${price} | ${signal.reason}`);
        } else {
          console.log(`[TRADE-ERROR] BUY ${symbol}: ${res.error}`);
        }
      }

      if (signal.action === "SELL" && position) {
        const res = this.broker.placeOrder({
          symbol,
          side: "SELL",
          quantity: position.quantity,
          price,
          reason: signal.reason,
        });

        if (res.ok) {
          this.stampTrade(symbol);
          console.log(`[TRADE] SELL ${symbol} x${position.quantity} @ ${price} | ${signal.reason}`);
        } else {
          console.log(`[TRADE-ERROR] SELL ${symbol}: ${res.error}`);
        }
      }
    }

    const endEquity = this.broker.getEquity(priceBySymbol);
    const pnl = endEquity - this.cfg.initialCapital;
    console.log(
      `[SUMMARY] Equity=${endEquity.toFixed(2)} PnL=${pnl.toFixed(2)} Cash=${this.broker.cash.toFixed(2)} OpenPositions=${this.broker.getOpenPositionsCount()}`
    );
  }

  async runForever() {
    console.log("[AGENT] Continuous monitoring started.");
    while (true) {
      try {
        await this.tick();
      } catch (error) {
        console.error(`[AGENT] Tick failed: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.cfg.pollMs));
    }
  }
}
