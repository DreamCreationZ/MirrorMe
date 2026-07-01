export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaValue = values[0];
  for (let i = 1; i < values.length; i += 1) {
    emaValue = values[i] * k + emaValue * (1 - k);
  }
  return emaValue;
}
