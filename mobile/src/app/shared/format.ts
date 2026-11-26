/** Punti come separatore delle migliaia, anche a 4 cifre (1.240), come nel design. */
export function formatThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
