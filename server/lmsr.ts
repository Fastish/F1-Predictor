/**
 * LMSR (Logarithmic Market Scoring Rule) Pricing Service
 * 
 * Implements automated market maker for prediction markets with unified pools.
 * Each championship pool (team/driver) uses LMSR to price all outcomes.
 */

/**
 * Compute the LMSR cost function
 * C(q) = b * ln(sum_i(e^(q_i/b)))
 * 
 * @param shares Array of shares outstanding for each outcome
 * @param b Liquidity parameter (higher = more liquid, more subsidy risk)
 * @returns Current cost state of the market
 */
export function costFunction(shares: number[], b: number): number {
  if (shares.length === 0) return 0;
  
  // Use log-sum-exp trick for numerical stability
  const maxShare = Math.max(...shares);
  const scaledExps = shares.map(q => Math.exp((q - maxShare) / b));
  const sum = scaledExps.reduce((a, c) => a + c, 0);
  return b * (Math.log(sum) + maxShare / b);
}

/**
 * Get current prices (probabilities) for all outcomes
 * Price of outcome i: p_i = e^(q_i/b) / sum_j(e^(q_j/b))
 * 
 * @param shares Array of shares outstanding for each outcome
 * @param b Liquidity parameter
 * @returns Array of prices (probabilities) for each outcome, sum to 1
 */
export function getPrices(shares: number[], b: number): number[] {
  if (shares.length === 0) return [];
  
  // Use log-sum-exp trick for numerical stability
  const maxShare = Math.max(...shares);
  const scaledExps = shares.map(q => Math.exp((q - maxShare) / b));
  const sum = scaledExps.reduce((a, c) => a + c, 0);
  return scaledExps.map(e => e / sum);
}

/**
 * Get the price for a single outcome
 * 
 * @param shares Array of shares outstanding for each outcome
 * @param b Liquidity parameter
 * @param index Index of the outcome to get price for
 * @returns Price (probability) of the outcome
 */
export function getPrice(shares: number[], b: number, index: number): number {
  const prices = getPrices(shares, b);
  return prices[index] ?? 0;
}

/**
 * Calculate cost to buy a given number of shares of a specific outcome
 * Cost = C(q_1, ..., q_i + amount, ..., q_n) - C(q_1, ..., q_i, ..., q_n)
 * 
 * @param shares Current shares outstanding for each outcome
 * @param b Liquidity parameter
 * @param index Index of outcome to buy
 * @param amount Number of shares to buy (positive) or sell (negative)
 * @returns Cost in collateral (positive = pay, negative = receive)
 */
export function getCostForShares(
  shares: number[],
  b: number,
  index: number,
  amount: number
): number {
  const before = costFunction(shares, b);
  const newShares = [...shares];
  newShares[index] += amount;
  const after = costFunction(newShares, b);
  return after - before;
}

/**
 * Calculate how many shares can be bought for a given collateral amount
 * Uses binary search to find the number of shares
 * 
 * @param shares Current shares outstanding for each outcome
 * @param b Liquidity parameter
 * @param index Index of outcome to buy
 * @param collateral Amount of collateral to spend
 * @returns Number of shares that can be bought
 */
export function getSharesForCost(
  shares: number[],
  b: number,
  index: number,
  collateral: number
): number {
  if (collateral <= 0) return 0;
  
  // Binary search for the number of shares
  let low = 0;
  let high = collateral * 100; // Upper bound estimate
  const tolerance = 0.0001;
  
  while (high - low > tolerance) {
    const mid = (low + high) / 2;
    const cost = getCostForShares(shares, b, index, mid);
    
    if (cost < collateral) {
      low = mid;
    } else {
      high = mid;
    }
  }
  
  return low;
}

/**
 * Calculate the average price per share for a purchase
 * 
 * @param shares Current shares outstanding
 * @param b Liquidity parameter
 * @param index Index of outcome
 * @param amount Number of shares to buy
 * @returns Average price per share
 */
export function getAveragePrice(
  shares: number[],
  b: number,
  index: number,
  amount: number
): number {
  if (amount === 0) return 0;
  const cost = getCostForShares(shares, b, index, amount);
  return cost / amount;
}

/**
 * Get pool summary with all outcome prices
 * 
 * @param outcomes Array of {participantId, sharesOutstanding}
 * @param b Liquidity parameter
 * @returns Array of {participantId, sharesOutstanding, price}
 */
export function getPoolPrices(
  outcomes: Array<{ participantId: string; sharesOutstanding: number }>,
  b: number
): Array<{ participantId: string; sharesOutstanding: number; price: number }> {
  const shares = outcomes.map(o => o.sharesOutstanding);
  const prices = getPrices(shares, b);
  
  return outcomes.map((outcome, index) => ({
    participantId: outcome.participantId,
    sharesOutstanding: outcome.sharesOutstanding,
    price: prices[index],
  }));
}

/**
 * Calculate potential payout if outcome wins
 * If you own X shares of the winning outcome, you get:
 * (X / total winning shares) * totalCollateral
 * 
 * @param sharesOwned Number of shares user owns
 * @param totalWinningShares Total shares outstanding for winning outcome
 * @param totalCollateral Total pool collateral
 * @returns Potential payout amount
 */
export function calculatePotentialPayout(
  sharesOwned: number,
  totalWinningShares: number,
  totalCollateral: number
): number {
  if (totalWinningShares === 0) return 0;
  return (sharesOwned / totalWinningShares) * totalCollateral;
}

/**
 * Validate a buy order before execution
 * 
 * @param shares Current shares for all outcomes
 * @param b Liquidity parameter
 * @param index Index of outcome to buy
 * @param amount Shares to buy
 * @param userBalance User's available balance
 * @returns {valid, cost, newPrice, error?}
 */
export function validateBuyOrder(
  shares: number[],
  b: number,
  index: number,
  amount: number,
  userBalance: number
): { valid: boolean; cost: number; newPrice: number; error?: string } {
  if (amount <= 0) {
    return { valid: false, cost: 0, newPrice: 0, error: "Amount must be positive" };
  }
  
  if (index < 0 || index >= shares.length) {
    return { valid: false, cost: 0, newPrice: 0, error: "Invalid outcome index" };
  }
  
  const cost = getCostForShares(shares, b, index, amount);
  
  if (cost > userBalance) {
    return { valid: false, cost, newPrice: 0, error: "Insufficient balance" };
  }
  
  const newShares = [...shares];
  newShares[index] += amount;
  const newPrice = getPrice(newShares, b, index);
  
  return { valid: true, cost, newPrice };
}
