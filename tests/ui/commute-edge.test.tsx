import { describe, expect, it } from 'vitest';
import { LOCKED_TEXT, commuteSaveError } from '../../client/src/components/employee/commuteModel';

// The MVP 1 CommuteEditor render cases were deleted with the component (#566); the model rule stays.
describe('commute save errors', () => {
  it('maps a 409 to the locked message', () => {
    expect(commuteSaveError(409, 'Planning is locked')).toBe(LOCKED_TEXT);
    expect(commuteSaveError(400, 'x')).toBe('Please fix the highlighted fields.');
    expect(commuteSaveError(500, 'Boom')).toBe('Boom');
  });
});
