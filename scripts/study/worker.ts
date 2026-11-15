// One worker thread of the study (scripts/study/parallel.ts starts it). It gets the travel cache, the fixtures
// and the assumptions once, as plain data, then simulates one run per message and sends its outcome back.
// No fs, no clock, no network: the same `runOutcome` as the single-threaded study, so the numbers are the same.
// An error other than an uncached pair is not caught here: the thread stops and the pool reports it.
import { parentPort, workerData } from 'node:worker_threads';
import { assumptionValues } from './assumptions';
import { runOutcome, studyInputOf, type RunOutcome, type StudyData } from './runner';
import type { Assumption, RunParams } from './types';

/** What a worker is started with. */
export type WorkerData = Pick<StudyData, 'files' | 'fixtures'> & { assumptions: Assumption[] };
/** Pool -> worker: simulate the run at `index` of the planned runs. */
export type WorkerRequest = { index: number; params: RunParams };
/** Worker -> pool: what that run came to. */
export type WorkerReply = { index: number; outcome: RunOutcome };

if (!parentPort) throw new Error('scripts/study/worker.ts only runs as a worker thread of scripts/study/parallel.ts');
const port = parentPort;
const data = workerData as WorkerData;
const input = studyInputOf(data);
const a = assumptionValues(data.assumptions);

port.on('message', (request: WorkerRequest) => {
  const reply: WorkerReply = { index: request.index, outcome: runOutcome(request.params, input, a) };
  port.postMessage(reply);
});
