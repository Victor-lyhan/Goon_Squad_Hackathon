import { describe, expect, it } from 'vitest';
import { CreateShipmentRequest } from '../shared/schemas';
import { jobIdFor, planIdFor, tripId } from '../shared/types';

const valid = {
  clientRequestId: 'req-1',
  originBusinessId: 'biz-a',
  destinationBusinessId: 'biz-b',
  label: 'Contract folder',
  category: 'envelope',
  description: 'Signed contracts',
  weightKg: 0.3,
  readyMin: 990,
  deadlineMin: 1950,
};

describe('shared contracts smoke test', () => {
  it('imports shared/types.ts ID helpers', () => {
    expect(tripId('emp-1', 'eve')).toBe('emp-1-eve');
    expect(jobIdFor(planIdFor('shp-1'), 0)).toBe('plan-shp-1-L0');
  });

  it('CreateShipmentRequest accepts a valid request', () => {
    expect(CreateShipmentRequest.safeParse(valid).success).toBe(true);
  });

  it('CreateShipmentRequest rejects sender = recipient', () => {
    const result = CreateShipmentRequest.safeParse({ ...valid, destinationBusinessId: 'biz-a' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('destinationBusinessId');
    }
  });
});
