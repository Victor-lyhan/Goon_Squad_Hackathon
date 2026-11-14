import type { Request, Response } from 'express';
import type { EmployeesResponse } from '../../shared/api';
import type { Store } from '../store';

export const getEmployees = (store: Store) => (_req: Request, res: Response<EmployeesResponse>) => {
  res.json({ employees: store.get().scenario.employees });
};
