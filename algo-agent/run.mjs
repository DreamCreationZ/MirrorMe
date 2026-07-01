import fs from "node:fs";
import path from "node:path";

import { getConfig, validateConfig } from "./config.mjs";
import { TradingAgent } from "./agent.mjs";
import { PaperBroker } from "./brokers/paperBroker.mjs";
import { GrowwBroker } from "./brokers/growwBroker.mjs";
import { AngelBroker } from "./brokers/angelBroker.mjs";
import { SimulatedMarketData } from "./marketData.mjs";

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;

  const content = fs.readFileSync(dotEnvPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const localEnvPath = path.resolve(process.cwd(), "algo-agent/.env");
loadDotEnv(localEnvPath);

const cfg = getConfig();

try {
  validateConfig(cfg);
} catch (error) {
  console.error(`[CONFIG] ${error.message}`);
  process.exit(1);
}

let broker;
if (cfg.mode === "paper") {
  broker = new PaperBroker(cfg.initialCapital);
} else if (cfg.mode === "groww") {
  broker = new GrowwBroker();
} else {
  broker = new AngelBroker();
}

const marketData = new SimulatedMarketData(cfg.symbols);
const agent = new TradingAgent({ cfg, broker, marketData });

console.log("[BOOT] Algo agent starting with config:");
console.log(JSON.stringify({ ...cfg, liveTradingEnabled: cfg.liveTradingEnabled }, null, 2));

agent.runForever();
