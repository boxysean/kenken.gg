// "Scan a photo", end to end: the picker (ScanButton) fills the ingest store,
// this panel runs the recognition pipeline on whatever lands there, summarises
// what it found, and offers to load the board into the editor. The detected
// corners go up through onCorners, so the solver view's export control
// (BoardExport) can save the corrected board plus those corners as a label.
import React, { useEffect, useRef, useState } from 'react';
import type { OcrImage, Quad, ScannedBoard } from './types';
import ScanButton from './ScanButton';
import type { ScanStore } from './ScanButton';
import * as ingestStore from './ingest/store';
import { labelToBoard } from './labelToBoard';
import type { BoardConversion } from './labelToBoard';
import { scanPhoto } from './pipeline/run';
import type { ScanResult } from './pipeline/run';
import type { ClueReader } from './pipeline/clueReader';
import { templateClueReader } from './pipeline/clueTemplate';
import { isPreparedClueReader, makeOnnxReader } from './infer/onnxReader';
import './ScanPanel.css';

export interface ScanPanelProps {
  onLoadBoard: (conversion: BoardConversion) => void;
  // The detected corners on a successful scan; null when the image is cleared,
  // replaced, or the scan fails.
  onCorners?: (corners: Quad | null) => void;
  scan?: typeof scanPhoto;
  reader?: ClueReader; // overrides the default, the ONNX reader (or its template fallback)
  store?: ScanStore;
}

function cageCount(board: ScannedBoard): number {
  return new Set(board.cageLetters.join(' ').split(' ').filter((letter) => letter !== '')).size;
}

// Shown as data-reader, so a silent fallback from the model is visible (e2e checks it).
function readerName(reader: ClueReader): string {
  if (isPreparedClueReader(reader)) return reader.name;
  return reader === templateClueReader ? 'template' : 'custom';
}

const ScanPanel: React.FC<ScanPanelProps> = ({
  onLoadBoard,
  onCorners,
  scan = scanPhoto,
  reader,
  store = ingestStore,
}) => {
  // Only the latest image's scan may land: an earlier, slower one is dropped.
  const requestRef = useRef(0);
  // The reader in use, once loaded; scans wait for it.
  const readerRef = useRef<Promise<ClueReader>>(Promise.resolve(templateClueReader));
  // Read through a ref so a new callback each render does not resubscribe (and rescan).
  const onCornersRef = useRef(onCorners);
  onCornersRef.current = onCorners;
  const [activeReader, setActiveReader] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Every result change goes through here, so the corners reported up always
  // belong to the result on screen, never to a stale scan.
  const showResult = (next: ScanResult | null) => {
    setResult(next);
    const corners = next && next.errors.length === 0 && next.board && next.corners ? next.corners : null;
    if (onCornersRef.current) onCornersRef.current(corners);
  };

  // Declared before the store subscription so readerRef is set when it first fires.
  useEffect(() => {
    let mounted = true;
    // makeOnnxReader never rejects: it falls back to the template reader.
    const loading = reader ? Promise.resolve(reader) : makeOnnxReader();
    readerRef.current = loading;
    loading.then((loaded) => {
      if (mounted) setActiveReader(readerName(loaded));
    });
    return () => {
      mounted = false;
    };
  }, [reader]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = store.subscribe((image: OcrImage | null) => {
      const request = ++requestRef.current;
      if (timer !== undefined) clearTimeout(timer);
      if (image === null) {
        setBusy(false);
        showResult(null);
        return;
      }
      setBusy(true);
      showResult(null);
      // The pipeline is synchronous and runs on the main thread (no worker yet),
      // so it is deferred a tick to let "Scanning…" paint before the page blocks.
      timer = setTimeout(() => {
        timer = undefined;
        readerRef.current.then(async (active) => {
          if (request !== requestRef.current) {
            return;
          }
          if (isPreparedClueReader(active)) {
            try {
              await active.prepare(image, scan);
            } catch (error) {
              // Unclassified characters read as null, so those cages need review.
              console.warn('clue reader: prepare failed', error);
            }
            if (request !== requestRef.current) {
              return;
            }
          }
          let scanned: ScanResult;
          try {
            scanned = scan(image, active);
          } catch (error) {
            // scanPhoto never throws, but an injected scan might.
            scanned = { lowConfidenceCages: [], errors: [`scan: ${error instanceof Error ? error.message : String(error)}`] };
          }
          if (request !== requestRef.current) {
            return;
          }
          setBusy(false);
          showResult(scanned);
        });
      }, 0);
    });
    return () => {
      // Invalidates any scan still in flight, so it never sets state after unmount.
      requestRef.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
    // showResult only touches state setters and a ref, so it is not a dependency.
  }, [store, scan, reader]);

  const failed = result !== null && result.errors.length > 0;
  const scannedBoard = result && !failed ? result.board : undefined;
  const corners = result && !failed ? result.corners : undefined;
  const shownErrors = failed ? result!.errors : [];

  return (
    <div className="ScanPanel" data-reader={activeReader}>
      <ScanButton store={store} />

      {busy &&
        <p className="ScanPanelStatus" role="status" data-testid="scan-status">Scanning…</p>
      }

      {failed &&
        <p className="ScanPanelStatus" role="status">The scan failed, so nothing was loaded into the editor.</p>
      }

      {scannedBoard &&
        <p className="ScanPanelSummary" data-testid="scan-summary">
          <span className="ScanPanelNumber">{cageCount(scannedBoard)}</span> cages found
          {' · '}
          <span className="ScanPanelNumber">{Object.keys(scannedBoard.clues).length}</span> clues read
          {' · '}
          <span className="ScanPanelNumber">{result!.lowConfidenceCages.length}</span> cages needing review
        </p>
      }

      {shownErrors.length > 0 &&
        <ul className="ScanPanelErrors" role="alert" data-testid="scan-errors">
          {shownErrors.map((error, index) => <li key={index}>{error}</li>)}
        </ul>
      }

      {scannedBoard && corners &&
        <div className="ScanPanelActions">
          <button
            type="button"
            className="ScanPanelButton"
            data-testid="scan-load"
            onClick={() => onLoadBoard(labelToBoard(scannedBoard))}
          >Load into editor</button>
        </div>
      }
    </div>
  );
};

export default ScanPanel;
