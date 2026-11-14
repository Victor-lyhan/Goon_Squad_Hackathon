import { useCallback, useEffect, useRef, useState } from 'react';
import './ui.css';

export type ToastKind = 'info' | 'success' | 'error';
export type ToastItem = { id: number; message: string; kind: ToastKind };

export type ToastsProps = {
  /** Toasts to render (from useToasts). */
  toasts: ToastItem[];
  /** Called with a toast id when it is dismissed. */
  onDismiss: (id: number) => void;
};

/** Renders the toast stack; place once near the app root. */
export function Toast({ toasts, onDismiss }: ToastsProps) {
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ui-toast ui-toast--${t.kind}`}>
          <span>{t.kind === 'error' ? 'Error: ' : t.kind === 'success' ? 'Done: ' : ''}{t.message}</span>
          <button type="button" onClick={() => onDismiss(t.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

/** Hook: `const { toasts, push, dismiss } = useToasts(); <Toast toasts={toasts} onDismiss={dismiss} />`. */
export function useToasts(durationMs = 4000) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((l) => [...l, { id, message, kind }]);
    const timer = setTimeout(() => { timers.current.delete(timer); dismiss(id); }, durationMs);
    timers.current.add(timer);
    return id;
  }, [dismiss, durationMs]);
  useEffect(() => { const set = timers.current; return () => set.forEach(clearTimeout); }, []);
  return { toasts, push, dismiss };
}
