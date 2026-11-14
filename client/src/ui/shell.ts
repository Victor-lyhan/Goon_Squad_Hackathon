/** Path after switching the demo account: same portal type, new id, no query/hash. null = not an identity route. */
export function switchIdentityPath(
  pathname: string,
  id: string,
): { kind: 'business' | 'employee'; path: string } | null {
  const m = /^\/(business|employee)\/[^/]+\/?$/.exec(pathname);
  if (!m || !id) return null;
  const kind = m[1] as 'business' | 'employee';
  return { kind, path: `/${kind}/${encodeURIComponent(id)}` };
}
