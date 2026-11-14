// Shared display formatters. Pure TS, no JSX/DOM. Data stays in minutes / cents / grams.

/** 8:30 AM style clock for minutes since Day 1 00:00 (day is ignored). */
export function formatClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "Day 2, 8:30 AM" for minutes since Day 1 00:00. */
export function formatMin(min: number): string {
  const safe = Number.isFinite(min) ? Math.max(0, Math.round(min)) : 0;
  const day = Math.floor(safe / 1440) + 1;
  return `Day ${day}, ${formatClock(safe)}`;
}

/** Integer cents -> "$10.00" (negatives as "-$1.50"). */
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const s = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 && abs > 0 ? `-${s}` : s;
}

/** Grams -> "0.3 kg" (at most one decimal, trailing ".0" dropped for whole kg). */
export function formatKg(grams: number): string {
  if (grams > 0 && grams < 50) return '<0.1 kg'; // never show a real parcel as "0 kg"
  const kg = Math.round(grams / 100) / 10;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

/** Minutes -> "6 min", or "1 h 5 min" from 60 up. */
export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
