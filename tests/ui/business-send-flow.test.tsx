import { describe, expect, it } from 'vitest';
import {
  createRequestIdHolder, defaultForm, formAfterResult, nextPackageForm,
} from '../../client/src/components/business/shipmentFormModel';

describe('send-a-package result flow: model', () => {
  const typed = { ...defaultForm(), originBusinessId: 'biz-1', destinationBusinessId: 'biz-2', label: 'Contracts', weightKg: '1.2', deadlineTime: '09:00' };

  it('Send another clears package fields and keeps the sender', () => {
    const next = nextPackageForm('biz-1');
    expect(next).toEqual({ ...defaultForm(), originBusinessId: 'biz-1' });
    expect(next.label).toBe('');
  });

  it('a match starts a fresh form; a no-match keeps every typed value', () => {
    expect(formAfterResult(typed, true)).toEqual(nextPackageForm('biz-1'));
    expect(formAfterResult(typed, false)).toEqual(typed);
  });

  it('a retry keeps the clientRequestId; reset (Send another) draws a new one', () => {
    const ids = createRequestIdHolder(() => 'biz-1');
    const first = ids.current();
    expect(ids.current()).toBe(first);
    ids.reset();
    expect(ids.current()).not.toBe(first);
  });
});
