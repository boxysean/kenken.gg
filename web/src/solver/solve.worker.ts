// Web Worker entry point for the client-side solver.
//
// WHY: `GameState.solve` is a depth-first search with constraint propagation. On a
// hard puzzle it can run for a couple of seconds, which would freeze the tab if it
// ran on the main thread. The whole solver therefore runs here, in a module worker,
// and the main thread only receives the finished board.
//
// MESSAGE PROTOCOL (plain structured-cloneable objects, no classes, no functions)
//
//   main -> worker   SolveRequest
//     { type: 'solve',
//       id: string,               // echo back on the response; lets the caller
//                                 // ignore a stale answer after a newer request
//       boardStrings: string[],   // one string per row, cells space separated,
//                                 // each cell the cage letter, e.g. 'a a b'
//       constraintString: string }// cages, freestanding, e.g. 'a=3+ b=6+ c=5+'
//
//   worker -> main   SolveResponse, exactly one per request
//     { type: 'solved', id, solved: true,
//       boardOutput: string,      // rows space separated, lines '\n' separated
//       cells: string[],          // row-major cell values
//       durationMs: number }      // time spent inside the solver, request -> done
//   | { type: 'solved', id, solved: false,
//       boardOutput: null, cells: null, durationMs }   // no solution exists
//   | { type: 'error', id, message: string, durationMs }  // unparseable puzzle
//
// The response for a request always carries that request's `id`, and nothing else
// is ever posted, so the client can match responses to requests one-to-one.
import { solveFromAPI } from './KenKenSolver';

export interface SolveRequest {
  type: 'solve';
  id: string;
  boardStrings: string[];
  constraintString: string;
}

export type SolveResponse =
  | {
      type: 'solved';
      id: string;
      solved: boolean;
      boardOutput: string | null;
      cells: string[] | null;
      durationMs: number;
    }
  | { type: 'error'; id: string; message: string; durationMs: number };

// eslint-disable-next-line no-restricted-globals
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (response: SolveResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<SolveRequest>) => {
  const request = event.data;
  if (request === null || typeof request !== 'object' || request.type !== 'solve') {
    return;
  }

  const startedAt = performance.now();
  try {
    const result = solveFromAPI(request.boardStrings, request.constraintString);
    workerScope.postMessage({
      type: 'solved',
      id: request.id,
      solved: result.solved,
      boardOutput: result.boardOutput,
      cells: result.cells,
      durationMs: performance.now() - startedAt,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
    });
  }
};
