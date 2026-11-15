// The study on several threads (node:worker_threads): the same runs as `runStudy`, simulated side by side.
// The pool hands the planned runs out one at a time and files every outcome under its place in the grid, so
// the results do not depend on which thread finished first: any number of workers gives the file one thread
// gives (tests/study/parallel.test.ts).
// The workers are TypeScript files, so each is started with the tsx loader of this project.
import { createRequire } from 'node:module';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DEFAULT_GRID, gridRuns } from './grid';
import { assembleStudy, runStudy, studyAssumptions, studyInputOf, type RunOutcome, type StudyData } from './runner';
import type { StudyResults } from './types';
import type { WorkerData, WorkerReply, WorkerRequest } from './worker';

const WORKER_FILE = new URL('./worker.ts', import.meta.url);

/** One worker per CPU core, less one for the thread that hands out the runs; never fewer than 1. */
export function defaultWorkerCount(): number {
  return Math.max(1, os.availableParallelism() - 1);
}

export type ParallelOptions = {
  /** How many workers to use. Default: `defaultWorkerCount()`. Never more than there are runs. */
  workers?: number;
  /** Told after every finished run how many are done. */
  onRun?: (done: number, planned: number) => void;
};

export type ParallelStudy = {
  results: StudyResults;
  /** The number of workers that ran the study. 1 means this thread ran it, with no worker thread. */
  workers: number;
};

/**
 * The whole study. With one worker it runs on this thread (`runStudy`); with more, on that many worker
 * threads. Rejects with the worker's error when a run fails for a reason other than an uncached pair.
 */
export async function runStudyParallel(data: StudyData, options: ParallelOptions = {}): Promise<ParallelStudy> {
  const grid = data.grid ?? DEFAULT_GRID;
  const planned = gridRuns(grid);
  const requested = options.workers ?? defaultWorkerCount();
  if (!Number.isInteger(requested) || requested < 1) throw new Error(`The number of study workers must be a whole number of 1 or more, got ${requested}`);
  const workers = Math.max(1, Math.min(requested, planned.length));
  if (workers === 1) return { results: runStudy(studyInputOf(data), options.onRun), workers };

  const assumptions = studyAssumptions(data.assumptions);
  const workerData: WorkerData = { files: data.files, fixtures: data.fixtures, assumptions };
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

  const outcomes = await new Promise<RunOutcome[]>((resolve, reject) => {
    const filed = new Array<RunOutcome>(planned.length);
    const pool: Worker[] = [];
    let next = 0;
    let done = 0;
    let settled = false;
    /** Stops every worker, then settles: once, whatever the workers still send. */
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      void Promise.allSettled(pool.map(worker => worker.terminate())).then(() => {
        if (error === undefined) resolve(filed);
        else reject(error instanceof Error ? error : new Error(String(error)));
      });
    };
    const give = (worker: Worker): void => {
      if (next >= planned.length) return;
      const request: WorkerRequest = { index: next, params: planned[next]! };
      next += 1;
      worker.postMessage(request);
    };
    try {
      for (let count = 0; count < workers; count += 1) {
        const worker = new Worker(WORKER_FILE, { workerData, execArgv: ['--import', tsxLoader] });
        pool.push(worker);
        worker.on('message', (reply: WorkerReply) => {
          if (settled) return;
          filed[reply.index] = reply.outcome;
          done += 1;
          try {
            options.onRun?.(done, planned.length);
          } catch (error) {
            finish(error);
            return;
          }
          if (done === planned.length) finish();
          else give(worker);
        });
        worker.on('error', error => finish(error));
        worker.on('exit', code => finish(new Error(`A study worker stopped before the study was done (exit code ${code})`)));
        give(worker);
      }
    } catch (error) {
      finish(error);
    }
  });
  return { results: assembleStudy(grid, assumptions, outcomes), workers };
}
