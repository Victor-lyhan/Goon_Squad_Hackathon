// The Business "New delivery" text box (MVP IV F1, docs/mvp4.md): one sentence, read by the server
// (POST /api/v2/parse-request), then shown in the existing New delivery form as the confirmation card
// (DECISIONS pass 81). This file reads and shows; it never sends a delivery: the form's button does.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ParseRequestResponse } from '../../../../../shared/v2/parseRequest';
import type { NetworkBusiness, Phase } from '../../../../../shared/v2/types';
import '../../../ui/ui.css'; // the kit's spinner mark (.ui-spinner), drawn here without the kit's status text
import { RESULT_COPY } from './newDeliveryModel';
import {
  PARSE_TEXT_MAX, PARSE_TIMEOUT_MS, REQUEST_COPY, checkRequestText, countText, exampleRequest, isParseAnswer,
  readProblem, type ParsedRequest, type ReadProblem,
} from './requestTextModel';
import './newDelivery.css';

/** `parseRequest` of client/src/api/v2 (tests pass a stub). */
export type ParseRequestCall = (text: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<ParseRequestResponse>;

export type RequestTextBoxProps = {
  origin: NetworkBusiness;
  businesses: NetworkBusiness[];
  phase: Phase;
  /** The sentence the box opens with ("Edit request" brings the last one back). Read once, on mount. */
  initialText?: string;
  parseRequest: ParseRequestCall;
  /** The server's answer and the sentence it was read from. The page opens the prefilled form. */
  onParsed: (response: ParseRequestResponse, text: string) => void;
  /** "Fill in the form instead": the page opens the empty form. */
  onFillForm: () => void;
  onCancel: () => void;
};

export function RequestTextBox(p: RequestTextBoxProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const [text, setText] = useState(p.initialText ?? '');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ReadProblem | null>(null);
  const busy = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  /** The read in flight; aborted when the box goes away, so a late answer never opens a form. */
  const reading = useRef<AbortController | null>(null);
  const locked = p.phase === 'locked';

  // The box is what New delivery opens on, so typing starts right away. Once, on mount.
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => () => { reading.current?.abort(); }, []);

  const read = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy.current || locked) return; // a double press reads once
    const checked = checkRequestText(text);
    if ('error' in checked) {
      setProblem({ kind: 'field', text: checked.error });
      box.current?.focus();
      return;
    }
    busy.current = true;
    // The pressed button is disabled while waiting, and a browser drops the focus of a disabled control.
    // The box keeps it instead (read-only meanwhile), so Esc still works and a failed read is back at the sentence.
    box.current?.focus();
    setPending(true);
    setProblem(null);
    const controller = new AbortController();
    reading.current = controller;
    try {
      const answer = await p.parseRequest(checked.text, { signal: controller.signal, timeoutMs: PARSE_TIMEOUT_MS });
      if (controller.signal.aborted) return;
      if (isParseAnswer(answer)) p.onParsed(answer, text);
      else setProblem({ kind: 'failed', text: REQUEST_COPY.failed });
    } catch (error) {
      if (!controller.signal.aborted) setProblem(readProblem(error));
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const fieldError = problem?.kind === 'field' ? problem.text : '';
  const alertText = locked ? RESULT_COPY.locked : problem?.kind === 'failed' ? problem.text : '';
  const describedBy = [id('hint'), id('count'), fieldError ? id('err') : ''].filter(Boolean).join(' ');

  return (
    <form className="nd-request" aria-labelledby={id('title')} noValidate onSubmit={(e) => { void read(e); }}
      onKeyDown={(e) => {
        // Esc anywhere in the box does what Cancel does, as in the form.
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); p.onCancel(); }
      }}>
      <div className="nd-head">
        <h2 className="nd-title" id={id('title')}>New delivery</h2>
        {/* The start of a route (#956): the package is at this business, and the line runs on to a stop the
            sentence has yet to name. The line is decoration. */}
        <p className="nd-from">
          <span className="nd-from__text">From {p.origin.name}{p.origin.neighborhood ? ` · ${p.origin.neighborhood}` : ''}</span>
          <span className="nd-route" aria-hidden="true" />
        </p>
      </div>

      <div className={`nd-field${fieldError ? ' nd-field--invalid' : ''}`}>
        <label className="nd-label" htmlFor={id('text')}>{REQUEST_COPY.label}</label>
        <textarea ref={box} id={id('text')} className="nd-input nd-request__text" rows={4} maxLength={PARSE_TEXT_MAX}
          placeholder={exampleRequest(p.origin, p.businesses)} value={text} readOnly={pending}
          aria-invalid={fieldError ? true : undefined} aria-describedby={describedBy}
          onChange={(e) => {
            setText(e.target.value);
            if (problem) setProblem(null); // the message was about the sentence before this edit
          }}
          onKeyDown={(e) => {
            // One sentence: Enter reads it (Shift+Enter still starts a new line; not while an IME is composing).
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void read(); }
          }} />
        <div className="nd-request__meta">
          <p className="nd-hint" id={id('hint')}>{REQUEST_COPY.hint}</p>
          <p className="nd-hint nd-request__count" id={id('count')}>
            <span className="nd-mono">{countText(text)}</span> characters
          </p>
        </div>
        {fieldError && <p className="nd-error" id={id('err')} role="alert">{fieldError}</p>}
      </div>

      <div className="nd-alert" role="alert">
        {alertText && <p className="nd-result__line nd-result__line--danger">{alertText}</p>}
      </div>
      {/* The wait is never blank (#880): the button is disabled and this line says what is happening. The
          region is in the page before the line, so a screen reader announces it; the spinner is decoration. */}
      <p className="nd-wait" role="status">{pending ? REQUEST_COPY.readingLine : ''}</p>

      <div className="nd-actions nd-request__actions">
        <button type="submit" className="nd-btn nd-btn--primary nd-request__read" disabled={pending || locked}
          aria-busy={pending || undefined}>
          {pending
            ? <><span className="ui-spinner" aria-hidden="true" />{REQUEST_COPY.reading}</>
            : REQUEST_COPY.read}
        </button>
        <button type="button" className="nd-btn" onClick={p.onFillForm}>{REQUEST_COPY.fillForm}</button>
        <button type="button" className="nd-btn" onClick={p.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export type ParsedRequestNoteProps = {
  parsed: ParsedRequest;
  /** Back to the text box with the sentence in it. */
  onEdit: () => void;
};

/**
 * The lines above the prefilled form, which together with it are the confirmation card: the sentence, who
 * read it ("Read by Gemini" / "Read by Relay’s rules", the latter with one plain line that says what it means), the
 * sender note, a rejected stop and what else the server chose, each as plain text. What it chose for the
 * recipient or the deliver-by time is under that field of the form instead (#948).
 */
export function ParsedRequestNote({ parsed, onEdit }: ParsedRequestNoteProps) {
  const note = useRef<HTMLElement>(null);
  // The card is read from its top: who read the sentence, the sentence, a refused stop, the sender. It takes
  // the place of the text box, so it is on screen already unless the page was scrolled past the top of the
  // box; `nearest` moves nothing then (#807). Once, when the card opens. Not in every DOM (jsdom has none).
  useEffect(() => {
    if (typeof note.current?.scrollIntoView === 'function') note.current.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <section className="nd-parsed" aria-label="Your request" ref={note}>
      <div className="nd-parsed__head">
        <p className="nd-parsed__source">{parsed.sourceLabel}</p>
        <button type="button" className="nd-btn nd-btn--link" onClick={onEdit}>{REQUEST_COPY.edit}</button>
      </div>
      {parsed.sourceLine && <p className="nd-hint nd-parsed__how">{parsed.sourceLine}</p>}
      <p className="nd-parsed__text">“{parsed.text.trim()}”</p>
      <div className="nd-parsed__notes" role="status">
        {parsed.rejected && <p className="nd-parsed__note nd-parsed__note--warn">{parsed.rejected}</p>}
        {parsed.senderNote && <p className="nd-parsed__note">{parsed.senderNote}</p>}
        {/* What the server chose that has no field of its own in the form (#948), in its own words. */}
        {parsed.notes.map((line) => <p key={line} className="nd-parsed__note">{line}</p>)}
        <p className="nd-hint">{REQUEST_COPY.confirm}</p>
      </div>
    </section>
  );
}
