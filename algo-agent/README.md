# Algo Trading Agent (Safe Starter)

This is a **continuous monitoring** trading agent starter with:
- signal generation (EMA trend strategy)
- auto-buy / auto-sell logic
- stop-loss, take-profit, trailing stop
- risk controls (position sizing, max open positions, max daily loss)
- **paper trading mode by default**

## Important reality check
No agent can guarantee "always profit" in real markets. This starter is designed to reduce risk and help you test safely before live execution.

## Run
1. Create env file:
   ```bash
   cp algo-agent/.env.example algo-agent/.env
   ```
2. Start agent:
   ```bash
   node algo-agent/run.mjs
   ```

The process keeps running and monitors the market loop continuously.

## Live broker wiring
- `algo-agent/brokers/growwBroker.mjs`
- `algo-agent/brokers/angelBroker.mjs`

These are intentionally guarded so live trading is not accidentally enabled.
Wire official broker auth + order endpoints/SDK there after paper strategy validation.

## Suggested rollout
1. Paper trade for at least 4-8 weeks.
2. Backtest across bull, bear, and sideways periods.
3. Go live with very small capital and strict limits.
4. Track slippage, costs, and drawdown before scaling.
