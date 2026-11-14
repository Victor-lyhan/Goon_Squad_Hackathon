// The first check of every /api/v2 request that has a JSON body (#521). router.ts registers it once, ahead
// of the route groups, so every route, also one added later, refuses the same broken bodies the same way:
//   - a `__proto__` key at any depth: nothing may reach an object spread, a copy or the state file under that name;
//   - nesting deeper than MAX_BODY_DEPTH: an imported file keeps its unknown keys, and a run nested thousands
//     of levels deep cannot be copied by the store, so every later change would fail;
//   - a text (or a key) longer than MAX_TEXT_LENGTH: the request schemas (shared/v2/schemas.ts) set no
//     maximum, and a stored 200 kB package name would travel in every poll of every tab.
// The answer is a 400 with the ApiError body. A body that is a list goes on: each route says in its own
// words what it wants instead (`null`, a string and a number never get here, the JSON parser refuses them).
// A request without a body is not checked: that is the valid form of the routes that take no options
// (retry, recompute, new planning cycle). Those routes use `takesNoOptions` to refuse a list.
// Pure apart from the two Express handlers at the bottom; no message echoes a value from the request.
import type express from 'express';
import type { ApiError } from '../../../shared/v2/schemas';

/** The longest text in a real run is under 150 characters (a notification), so no honest form comes near this. */
export const MAX_TEXT_LENGTH = 2000;
/** A run export is 8 levels deep. */
export const MAX_BODY_DEPTH = 32;

export const NO_OPTIONS = 'This action takes no options. Send no body or an empty JSON object.';
export const BODY_KEY_NOT_ALLOWED = 'The request body holds a key that is not allowed';
export const BODY_TOO_DEEP = 'The request body is nested too deeply';
export const BODY_TEXT_TOO_LONG = 'A text in the request body is too long';
export const TEXT_TOO_LONG = `Max ${MAX_TEXT_LENGTH} characters`;

/** One object or list of the body that still has to be looked at, with the way back up for its path. */
type Open = { value: object; key: string; parent: Open | null; depth: number };

/** `scenario.shipments.3.label` for `key` inside `open`. Built only for the one text that is refused. */
function pathOf(open: Open, key: string): string {
  const parts = [key];
  for (let at: Open | null = open; at?.parent; at = at.parent) parts.push(at.key);
  return parts.reverse().join('.');
}

/**
 * The 400 body for a parsed JSON body no route may get, or null when the body can go on to its route.
 * A text that is too long is named by its path (`label`, `home.neighborhood`, `scenario.shipments.3.label`),
 * so a form can show the message beside the field.
 */
export function bodyProblem(body: unknown): ApiError | null {
  if (typeof body !== 'object' || body === null) return null;

  // A loop, not recursion: the JSON parser accepts far deeper nesting than a recursive walk survives.
  const todo: Open[] = [{ value: body, key: '', parent: null, depth: 1 }];
  for (let open = todo.pop(); open; open = todo.pop()) {
    if (open.depth > MAX_BODY_DEPTH) return { error: BODY_TOO_DEEP };
    const fields = open.value as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (key === '__proto__') return { error: BODY_KEY_NOT_ALLOWED };
      if (key.length > MAX_TEXT_LENGTH) return { error: BODY_TEXT_TOO_LONG };
      const child = fields[key];
      if (typeof child === 'string') {
        if (child.length > MAX_TEXT_LENGTH) {
          return { error: BODY_TEXT_TOO_LONG, fieldErrors: { [pathOf(open, key)]: TEXT_TOO_LONG } };
        }
      } else if (typeof child === 'object' && child !== null) {
        todo.push({ value: child, key, parent: open, depth: open.depth + 1 });
      }
    }
  }
  return null;
}

/** Router-wide: answers 400 for a body `bodyProblem` refuses; lets every other request through untouched. */
export function refuseBrokenBody(req: express.Request, res: express.Response<ApiError>, next: express.NextFunction): void {
  const problem = req.body === undefined ? null : bodyProblem(req.body);
  if (problem) {
    res.status(400).json(problem);
    return;
  }
  next();
}

/**
 * For a route that takes no options, in front of its handler: no body and a JSON object go on,
 * anything else is a 400, so a broken request never triggers the action.
 */
export function takesNoOptions(req: express.Request, res: express.Response<ApiError>, next: express.NextFunction): void {
  const { body } = req;
  if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
    res.status(400).json({ error: NO_OPTIONS });
    return;
  }
  next();
}
