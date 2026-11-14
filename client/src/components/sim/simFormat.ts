// Temporary local copy of formatMin; swap for client/src/ui/format.ts once #6 merges.
export function formatMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const day = Math.floor(m / 1440) + 1;
  const h24 = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `Day ${day}, ${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
