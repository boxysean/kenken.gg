// Main-thread client for the solve worker. See solve.worker.ts for the protocol.
//
// One worker is created per solve and terminated as soon as the answer arrives, so
// a puzzle that is still searching can never pile up behind a newer one.
import type { SolveRequest, SolveResponse } from './solve.worker';

export interface SolveWorkerResult {
  solved: boolean;
  boardOutput: string | null;
  cells: string[] | null;
  // Wall-clock time measured inside the worker, main thread -> answer.
  durationMs: number;
}

let nextRequestId = 0;

export function solveInWorker(boardStrings: string[], constraintString: string): Promise<SolveWorkerResult> {
  return new Promise((resolve, reject) => {
    const id = 'solve-' + ++nextRequestId;
    const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<SolveResponse>) => {
      const response = event.data;
      if (response.id !== id) {
        return;
      }
      worker.terminate();
      if (response.type === 'error') {
        reject(new Error(response.message));
      } else {
        resolve({
          solved: response.solved,
          boardOutput: response.boardOutput,
          cells: response.cells,
          durationMs: response.durationMs,
        });
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new Error(event.message || 'solver worker failed'));
    };

    const request: SolveRequest = { type: 'solve', id, boardStrings, constraintString };
    worker.postMessage(request);
  });
}
