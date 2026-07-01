import { ema } from "../lib/indicators.mjs";

export function evaluateSignal({ prices, position, cfg }) {
  const minBars = Math.max(cfg.slowEmaPeriod + 2, 25);
  if (prices.length < minBars) {
    return { action: "HOLD", reason: `Need ${minBars - prices.length} more bars` };
  }

  const latestPrice = prices.at(-1);
  const fast = ema(prices.slice(-cfg.fastEmaPeriod * 5), cfg.fastEmaPeriod);
  const slow = ema(prices.slice(-cfg.slowEmaPeriod * 5), cfg.slowEmaPeriod);

  if (!fast || !slow) {
    return { action: "HOLD", reason: "Indicators warming up" };
  }

  if (!position && fast > slow) {
    return {
      action: "BUY",
      reason: `Trend up: EMA${cfg.fastEmaPeriod} (${fast.toFixed(2)}) > EMA${cfg.slowEmaPeriod} (${slow.toFixed(2)})`,
      price: latestPrice,
    };
  }

  if (!position) {
    return { action: "HOLD", reason: "No long entry signal" };
  }

  const entry = position.avgPrice;
  const pnlPct = ((latestPrice - entry) / entry) * 100;
  const drawdownFromPeakPct = ((position.peakPrice - latestPrice) / position.peakPrice) * 100;

  if (pnlPct <= -cfg.stopLossPct) {
    return {
      action: "SELL",
      reason: `Stop loss hit: ${pnlPct.toFixed(2)}% <= -${cfg.stopLossPct}%`,
      price: latestPrice,
    };
  }

  if (pnlPct >= cfg.takeProfitPct) {
    return {
      action: "SELL",
      reason: `Take profit hit: ${pnlPct.toFixed(2)}% >= ${cfg.takeProfitPct}%`,
      price: latestPrice,
    };
  }

  if (drawdownFromPeakPct >= cfg.trailingStopPct) {
    return {
      action: "SELL",
      reason: `Trailing stop hit: ${drawdownFromPeakPct.toFixed(2)}% from peak`,
      price: latestPrice,
    };
  }

  if (fast < slow) {
    return {
      action: "SELL",
      reason: `Trend reversal: EMA${cfg.fastEmaPeriod} (${fast.toFixed(2)}) < EMA${cfg.slowEmaPeriod} (${slow.toFixed(2)})`,
      price: latestPrice,
    };
  }

  return { action: "HOLD", reason: "Position managed, no exit signal" };
}
