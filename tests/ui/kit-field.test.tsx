import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field } from '../../client/src/ui/Field';

describe('Field aria-describedby', () => {
  it('merges the child aria-describedby with hint and error ids', () => {
    const html = renderToStaticMarkup(
      <Field label="Name" hint="h" error="e">
        <input aria-describedby="custom" />
      </Field>,
    );
    const m = html.match(/aria-describedby="([^"]*)"/);
    expect(m?.[1]).toMatch(/^custom .+-hint .+-error$/);
  });
});
