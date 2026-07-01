export function shouldHaltForDailyLoss({ dayStartEquity, currentEquity, maxDailyLossPct }) {
  const lossPct = ((dayStartEquity - currentEquity) / dayStartEquity) * 100;
  return lossPct >= maxDailyLossPct;
}

export function calculateBuyQuantity({
  equity,
  price,
  stopLossPct,
  riskPerTradePct,
  maxPositionPct = 20,
}) {
  const riskAmount = equity * (riskPerTradePct / 100);
  const stopDistance = price * (stopLossPct / 100);
  if (riskAmount <= 0 || stopDistance <= 0) return 0;

  const qtyByRisk = Math.floor(riskAmount / stopDistance);
  const maxNotional = equity * (maxPositionPct / 100);
  const qtyByExposure = Math.floor(maxNotional / price);

  return Math.max(0, Math.min(qtyByRisk, qtyByExposure));
}
