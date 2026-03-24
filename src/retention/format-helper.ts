/**
 * Format a number as South African Rand currency string.
 * e.g. 45.5 → "R45.50"
 */
export function formatToCurrency(amount: number): string {
  return `R${amount.toFixed(2)}`;
}
