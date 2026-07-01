const parseNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseBool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const parseCsv = (value, fallback) => {
  const raw = value ?? fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export function getConfig() {
  return {
    mode: process.env.TRADING_MODE ?? "paper", // paper | groww | angel
    pollMs: parseNumber(process.env.POLL_MS, 15_000),
    symbols: parseCsv(
      process.env.SYMBOLS,
      "NSE:RELIANCE,NSE:TCS,NSE:HDFCBANK,NSE:INFY,NSE:ICICIBANK"
    ),

    initialCapital: parseNumber(process.env.INITIAL_CAPITAL, 200_000),
    riskPerTradePct: parseNumber(process.env.RISK_PER_TRADE_PCT, 1.0),
    maxDailyLossPct: parseNumber(process.env.MAX_DAILY_LOSS_PCT, 3.0),
    maxOpenPositions: Math.max(1, parseNumber(process.env.MAX_OPEN_POSITIONS, 3)),
    cooldownMs: parseNumber(process.env.COOLDOWN_MS, 30_000),

    fastEmaPeriod: Math.max(2, parseNumber(process.env.FAST_EMA_PERIOD, 9)),
    slowEmaPeriod: Math.max(3, parseNumber(process.env.SLOW_EMA_PERIOD, 21)),
    stopLossPct: parseNumber(process.env.STOP_LOSS_PCT, 1.2),
    takeProfitPct: parseNumber(process.env.TAKE_PROFIT_PCT, 2.4),
    trailingStopPct: parseNumber(process.env.TRAILING_STOP_PCT, 0.8),

    liveTradingEnabled: parseBool(process.env.LIVE_TRADING_ENABLED, false),
    dryRun: parseBool(process.env.DRY_RUN, true),
  };
}

export function validateConfig(cfg) {
  if (!cfg.symbols.length) {
    throw new Error("No symbols configured. Set SYMBOLS in env.");
  }
  if (cfg.fastEmaPeriod >= cfg.slowEmaPeriod) {
    throw new Error("FAST_EMA_PERIOD must be less than SLOW_EMA_PERIOD.");
  }
  if (!["paper", "groww", "angel"].includes(cfg.mode)) {
    throw new Error('TRADING_MODE must be one of: "paper", "groww", "angel".');
  }
  if (cfg.mode !== "paper" && !cfg.liveTradingEnabled) {
    throw new Error(
      "Live mode selected but LIVE_TRADING_ENABLED is false. Keep paper mode for safety while tuning."
    );
  }
}
