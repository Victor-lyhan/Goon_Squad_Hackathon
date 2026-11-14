// Two small display-only helpers the v2 motion files share, moved unchanged from the MVP 1
// marker tween (#692). The backend decides positions; these only help interpolate between polls.

export const clampAlpha = (a: number): number => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1);

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
