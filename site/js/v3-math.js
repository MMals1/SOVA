// ══════════════════════════════════════════════════════════════════════
// v3-math.js — Pure Uniswap V3 math helpers (no DOM dependencies)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert sqrtPriceX96 (Q64.96 fixed-point) to a human-readable price.
 */
export function sqrtPriceToPrice(sqrtPriceX96, dec0 = 18, dec1 = 18) {
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  return sqrtPrice * sqrtPrice * 10 ** (dec0 - dec1);
}

/**
 * Convert a human-readable price to the nearest V3 tick index.
 */
export function priceToTick(price) {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/**
 * Convert a tick index back to a price.
 */
export function tickToPrice(tick) {
  return 1.0001 ** tick;
}

/**
 * Round a tick to the nearest usable tick for a given tick spacing.
 */
export function nearestUsableTick(tick, tickSpacing) {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

/**
 * Calculate token amounts held by a position given its liquidity and range.
 */
export function calculatePositionAmounts(
  liquidity,
  sqrtPriceX96,
  tickLower,
  tickUpper,
  dec0 = 18,
  dec1 = 18,
) {
  const sqrtPa = Math.sqrt(tickToPrice(tickLower));
  const sqrtPb = Math.sqrt(tickToPrice(tickUpper));
  const sqrtPc = Number(sqrtPriceX96) / 2 ** 96;
  const L = Number(liquidity);
  let amount0 = 0,
    amount1 = 0;
  if (sqrtPc <= sqrtPa) {
    amount0 = L * (1 / sqrtPa - 1 / sqrtPb);
  } else if (sqrtPc < sqrtPb) {
    amount0 = L * (1 / sqrtPc - 1 / sqrtPb);
    amount1 = L * (sqrtPc - sqrtPa);
  } else {
    amount1 = L * (sqrtPb - sqrtPa);
  }
  return {
    amount0: amount0 / 10 ** dec0,
    amount1: amount1 / 10 ** dec1,
  };
}

/**
 * Calculate impermanent loss given the ratio of current price to entry price.
 * Returns a negative number representing the loss fraction.
 */
export function calculateImpermanentLoss(priceRatio) {
  const r = priceRatio;
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}
