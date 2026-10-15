export function sign(n: number): string {
  if (n < 0) return 'negative';
  if (n === 0) return 'zero';
  return 'positive';
}
