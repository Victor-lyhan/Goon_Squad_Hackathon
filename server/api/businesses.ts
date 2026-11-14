import type { Request, Response } from 'express';
import type { BusinessesResponse } from '../../shared/api';
import type { Store } from '../store';

export const getBusinesses = (store: Store) => (_req: Request, res: Response<BusinessesResponse>) => {
  const { businesses, hubs } = store.get().scenario;
  res.json({ businesses, hubs });
};
