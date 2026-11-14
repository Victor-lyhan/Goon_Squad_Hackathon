import { useEffect, useId, useRef, type ReactNode } from 'react';
import { FOCUSABLE_SELECTOR, nextFocusIndex } from './focusCycle';
import './ui.css';

export type DrawerProps = {
  /** Whether the drawer is shown. */
  open: boolean;
  /** Called on close button, backdrop click or Esc. */
  onClose: () => void;
  /** Heading text (also the dialog's accessible name). */
  title: string;
  /** Drawer content. */
  children?: ReactNode;
};

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.ui-drawer__close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const to = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to === null) {
        if (items.length === 0) e.preventDefault();
        else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus(); }
        return;
      }
      e.preventDefault();
      items[to].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="ui-drawer__backdrop" onClick={onClose} />
      <div className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="ui-drawer__header">
          <h2 className="ui-drawer__title" id={titleId}>{title}</h2>
          <button type="button" className="ui-drawer__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </>
  );
}
