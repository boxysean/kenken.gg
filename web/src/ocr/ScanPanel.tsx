// "Scan a photo", end to end: the picker (ScanButton) fills the ingest store,
// this panel runs the recognition pipeline on whatever lands there, summarises
// what it found, and offers to load the board into the editor. Once the user has
// corrected the board by hand, "Download label JSON" exports their corrections
// plus the detected corners as an OcrLabel, ready to become a training example.
import React, { useEffect, useRef, useState } from 'react';
import type { OcrImage, Quad, ScannedBoard } from './types';
import ScanButton from './ScanButton';
import type { ScanStore } from './ScanButton';
import * as ingestStore from './ingest/store';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { BoardConversion } from './labelToBoard';
import { boardToLabel } from './boardToLabel';
import { scanPhoto } from './pipeline/run';
import type { ScanResult } from './pipeline/run';
import type { ClueReader } from './pipeline/clueReader';
import { templateClueReader } from './pipeline/clueTemplate';
import { isPreparedClueReader, makeOnnxReader } from './infer/onnxReader';
import './ScanPanel.css';

export interface ScanPanelProps {
  onLoadBoard: (conversion: BoardConversion) => void;
  board?: ScannedBoard | null; // the CURRENT editor board, for the download
  scan?: typeof scanPhoto;
  reader?: ClueReader; // overrides the default, the ONNX reader (or its template fallback)
  store?: ScanStore;
}

export const LABEL_FILENAME = 'kenken-label.json';

// Saves a value as a pretty-printed JSON file through a temporary object URL.
// Kept apart from the component so tests can drive it with Blob and URL stubbed.
export function downloadJson(value: unknown, filename: string = LABEL_FILENAME): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  // Firefox ignores clicks on links that are not in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  board = null,
  scan = scanPhoto,
  reader,
  store = ingestStore,
}) => {
  // Only the latest image's scan may land: an earlier, slower one is dropped.
  const requestRef = useRef(0);
  // The reader in use, once loaded; scans wait for it.
  const readerRef = useRef<Promise<ClueReader>>(Promise.resolve(templateClueReader));
  const [activeReader, setActiveReader] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportErrors, setExportErrors] = useState<string[]>([]);

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
      setExportErrors([]);
      if (image === null) {
        setBusy(false);
        setResult(null);
        return;
      }
      setBusy(true);
      setResult(null);
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
          setResult(scanned);
        });
      }, 0);
    });
    return () => {
      // Invalidates any scan still in flight, so it never sets state after unmount.
      requestRef.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, scan, reader]);

  const onDownload = (corners: Quad) => {
    if (!board) {
      return;
    }
    const label = boardToLabel(board, corners);
    const problems = validateLabel(label);
    setExportErrors(problems);
    if (problems.length === 0) {
      downloadJson(label);
    }
  };

  const failed = result !== null && result.errors.length > 0;
  const scannedBoard = result && !failed ? result.board : undefined;
  const corners = result && !failed ? result.corners : undefined;
  const shownErrors = failed ? result!.errors : exportErrors;

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
          <button
            type="button"
            className="ScanPanelButton"
            data-testid="scan-download"
            disabled={!board}
            onClick={() => onDownload(corners)}
          >Download label JSON</button>
        </div>
      }
    </div>
  );
};

export default ScanPanel;
