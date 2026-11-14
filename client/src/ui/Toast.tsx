import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';

export type ToastKind = 'info' | 'success' | 'error';
export type ToastItem = { id: number; message: string; kind: ToastKind };

export type ToastsProps = {
  /** Toasts to render (from useToasts). */
  toasts: ToastItem[];
  /** Called with a toast id when it is dismissed. */
  onDismiss: (id: number) => void;
  /** Optional: hold auto-dismiss while a toast is hovered or focused (useToasts wires this up automatically). */
  onPause?: (key: string) => void;
  /** Optional: release a hold taken with onPause. */
  onResume?: (key: string) => void;
  /** Max toasts shown at once (default 3). */
  maxVisible?: number;
};

export const MAX_VISIBLE_TOASTS = 3;

/** Pure: newest `max` toasts are visible (oldest first); older ones fold into a "+N more" count. */
export function visibleToasts<T>(toasts: readonly T[], max = MAX_VISIBLE_TOASTS): { visible: T[]; hidden: number } {
  const cap = Math.max(1, Math.floor(max) || MAX_VISIBLE_TOASTS);
  const hidden = Math.max(0, toasts.length - cap);
  return { visible: toasts.slice(hidden), hidden };
}

type Pauser = { pause: (key: string) => void; resume: (key: string) => void };
/** Lets `<Toast onDismiss={dismiss}>` find the pause controls of the hook that made `dismiss`. */
const pausers = new WeakMap<object, Pauser>();

function ToastRow({ toast, onDismiss, onPause, onResume }: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  onPause?: (key: string) => void;
  onResume?: (key: string) => void;
}) {
  const id = toast.id;
  const held = useRef(new Set<string>());
  const hold = (reason: string) => { const k = `${id}:${reason}`; held.current.add(k); onPause?.(k); };
  const release = (reason: string) => { const k = `${id}:${reason}`; if (held.current.delete(k)) onResume?.(k); };
  // A dismissed toast never gets mouseleave/blur, so release any hold on unmount.
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  useEffect(() => { const set = held.current; return () => { set.forEach((k) => resumeRef.current?.(k)); set.clear(); }; }, []);
  const label = toast.kind === 'error' ? 'Error: ' : toast.kind === 'success' ? 'Done: ' : '';
  return (
    <div
      className={`ui-toast ui-toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={() => hold('hover')}
      onMouseLeave={() => release('hover')}
      onFocus={() => hold('focus')}
      onBlur={() => release('focus')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss(id); } }}
    >
      <span>{label}{toast.message}</span>
      <button type="button" aria-label={`Dismiss notification: ${label}${toast.message}`} onClick={() => onDismiss(id)}>Dismiss</button>
    </div>
  );
}

/** Renders the toast stack; place once near the app root. */
export function Toast({ toasts, onDismiss, onPause, onResume, maxVisible = MAX_VISIBLE_TOASTS }: ToastsProps) {
  const auto = pausers.get(onDismiss);
  const pause = onPause ?? auto?.pause;
  const resume = onResume ?? auto?.resume;
  const { visible, hidden } = visibleToasts(toasts, maxVisible);
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {hidden > 0 && <div className="ui-toasts__more">+{hidden} more</div>}
      {visible.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} onPause={pause} onResume={resume} />
      ))}
    </div>
  );
}

/** Framework-free auto-dismiss timers that can be held (hover/focus) and resumed without losing time. */
export class ToastTimers {
  private entries = new Map<number, { remaining: number; startedAt: number | null; timer: ReturnType<typeof setTimeout> | null }>();
  private holds = new Set<string>();
  constructor(private onExpire: (id: number) => void) {}
  add(id: number, ms: number) {
    const e = { remaining: ms, startedAt: null as number | null, timer: null as ReturnType<typeof setTimeout> | null };
    this.entries.set(id, e);
    if (this.holds.size === 0) this.run(id);
  }
  remove(id: number) { const e = this.entries.get(id); if (e?.timer) clearTimeout(e.timer); this.entries.delete(id); }
  pause(key: string) {
    const was = this.holds.size;
    this.holds.add(key);
    if (was > 0) return;
    this.entries.forEach((e) => {
      if (e.startedAt !== null) e.remaining = Math.max(0, e.remaining - (Date.now() - e.startedAt));
      e.startedAt = null;
      if (e.timer) clearTimeout(e.timer);
      e.timer = null;
    });
  }
  resume(key: string) {
    if (!this.holds.delete(key) || this.holds.size > 0) return;
    this.entries.forEach((e, id) => { if (!e.timer) this.run(id); });
  }
  dispose() { this.entries.forEach((e) => { if (e.timer) clearTimeout(e.timer); }); this.entries.clear(); this.holds.clear(); }
  private run(id: number) {
    const e = this.entries.get(id)!;
    e.startedAt = Date.now();
    e.timer = setTimeout(() => { this.entries.delete(id); this.onExpire(id); }, e.remaining);
  }
}

/** Hook: `const { toasts, push, dismiss } = useToasts(); <Toast toasts={toasts} onDismiss={dismiss} />`. */
export function useToasts(durationMs = 4000) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const remove = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  const timers = useMemo(() => new ToastTimers(remove), [remove]);
  const dismiss = useCallback((id: number) => { timers.remove(id); remove(id); }, [timers, remove]);
  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((l) => [...l, { id, message, kind }]);
    timers.add(id, durationMs);
    return id;
  }, [timers, durationMs]);
  const pause = useCallback((key: string) => timers.pause(key), [timers]);
  const resume = useCallback((key: string) => timers.resume(key), [timers]);
  pausers.set(dismiss, { pause, resume });
  useEffect(() => () => timers.dispose(), [timers]);
  return { toasts, push, dismiss, pause, resume };
}
