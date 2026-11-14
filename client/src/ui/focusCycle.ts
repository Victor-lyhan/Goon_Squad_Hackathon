/** Pure focus-trap logic: which index should get focus when Tab/Shift+Tab is pressed.
 *  `current` is the index of the focused item in the focusable list, or -1 when focus is
 *  outside the list. Returns null when the browser's default Tab behaviour is fine. */
export function nextFocusIndex(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
