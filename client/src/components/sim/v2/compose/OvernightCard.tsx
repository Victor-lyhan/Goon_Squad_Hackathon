// The card a relay journey shows in place of the night (#648, docs/mvp3.md P1): "Overnight at
// <relay point>" over the map for about 1 s, between the evening leg and the morning leg. Network
// Play (no package picked, #790) shows it the same way between the evening and the morning commutes.
// Stateless: the page body says when (journeyPlay.ts `overnightText`); the driver times it.

function MoonIcon() {
  return (
    <svg className="spc-overnight__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" />
    </svg>
  );
}

/** Not a live region itself: the page body puts it into its always-mounted `role="status"` (#725). */
export function OvernightCard({ text }: { text: string }) {
  return (
    <p className="spc-overnight">
      <MoonIcon />
      <span>{text}</span>
    </p>
  );
}
