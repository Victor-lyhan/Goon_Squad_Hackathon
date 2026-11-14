// Real-DOM test harness (DECISIONS pass 43, #505). Only for test files whose first line is
// `// @vitest-environment jsdom`; every other test stays in Node. Uses react-dom/client and React's `act`,
// no @testing-library. Name DOM tests `tests/ui/<owner prefix>-dom-*.test.tsx`.
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';

// Tells React that updates are wrapped in act(), so it flushes them and warns about any that are not.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Mounted = {
  container: HTMLElement;
  rerender: (element: ReactElement) => void;
  unmount: () => void;
};

const mounted = new Set<Mounted>();

afterEach(() => {
  for (const m of [...mounted]) m.unmount();
  document.body.innerHTML = '';
});

/** Renders into a fresh container attached to document.body (so focus works). Unmounted after each test. */
export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  const m: Mounted = {
    container,
    rerender: (next) => { act(() => { root.render(next); }); },
    unmount: () => {
      if (!mounted.delete(m)) return;
      act(() => { root.unmount(); });
      container.remove();
    },
  };
  mounted.add(m);
  return m;
}

/** Sets an element's value the way a user does, so React's value tracker sees a change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) throw new Error('element has no value setter');
  setter.call(el, value);
}

/** Replaces the text of an input or textarea (focus, then one input event, as typing ends up). */
export function typeInto(el: Element, text: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('typeInto(): not an input');
  act(() => {
    el.focus();
    setNativeValue(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Picks the option whose visible text (or value) equals `option`. */
export function select(el: Element, option: string) {
  if (!(el instanceof HTMLSelectElement)) throw new Error('select(): not a select');
  const opt = [...el.options].find((o) => o.text.trim() === option) ?? [...el.options].find((o) => o.value === option);
  if (!opt) throw new Error(`select(): no option "${option}" in ${[...el.options].map((o) => o.text).join(', ')}`);
  act(() => {
    el.focus();
    setNativeValue(el, opt.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** A real click: a submit button also submits its form (jsdom runs the activation behavior). */
export function click(el: Element) {
  act(() => {
    if (el instanceof HTMLElement) el.focus();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

/** keydown then keyup on `el` (default: the focused element). */
export function press(key: string, el: Element = document.activeElement ?? document.body) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  });
}

/** Lets pending promises and zero-delay timers settle, then flushes React's updates. */
export async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A promise you settle from the test, for a request that is still pending. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ---------- Queries ----------

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Visible text of an element, whitespace collapsed. */
export function textOf(el: Element): string {
  return norm(el.textContent);
}

/** The form control labelled exactly `label` (through <label for>). */
export function byLabel(root: ParentNode, label: string): HTMLElement {
  const found = [...root.querySelectorAll('label')].filter((l) => norm(l.textContent) === label);
  if (found.length !== 1) throw new Error(`byLabel(): ${found.length} labels "${label}"`);
  const control = found[0].control ?? (found[0].htmlFor ? document.getElementById(found[0].htmlFor) : null);
  if (!control) throw new Error(`byLabel(): label "${label}" has no control`);
  return control as HTMLElement;
}

/** The one button whose text is exactly `name` (or matches it). */
export function button(root: ParentNode, name: string | RegExp): HTMLButtonElement {
  const all = buttons(root, name);
  if (all.length !== 1) throw new Error(`button(): ${all.length} buttons "${String(name)}"`);
  return all[0];
}

export function buttons(root: ParentNode, name: string | RegExp): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((b) =>
    typeof name === 'string' ? norm(b.textContent) === name : name.test(norm(b.textContent)));
}

/** The one link whose text is exactly `name` (or matches it). */
export function link(root: ParentNode, name: string | RegExp): HTMLAnchorElement {
  const all = [...root.querySelectorAll('a')].filter((a) =>
    typeof name === 'string' ? norm(a.textContent) === name : name.test(norm(a.textContent)));
  if (all.length !== 1) throw new Error(`link(): ${all.length} links "${String(name)}"`);
  return all[0];
}

const FOCUSABLE = 'a[href], button, select, input, textarea, [tabindex]';

/**
 * The elements Tab visits, in order (jsdom has no Tab key of its own): positive tabindex first, then
 * document order; skips disabled controls, tabindex="-1", and anything inside [hidden] or inert.
 */
export function tabOrder(root: ParentNode = document.body): HTMLElement[] {
  const els = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    el.tabIndex >= 0
    && !(el as HTMLButtonElement).disabled
    && !el.closest('[hidden], [inert]')
    && !(el instanceof HTMLInputElement && el.type === 'hidden'));
  const positive = els.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...els.filter((el) => el.tabIndex === 0)];
}
