// The solver view's one export control, there whether or not a photo is in
// play. With corners (from a scan, or four clicks in LabelPanel) it saves a
// full label, kenken-label.json; without, the board alone, kenken-board.json.
// Either way the file goes through validateLabel first and nothing is saved
// while it has problems.
import React, { useState } from 'react';
import type { OcrSource, Quad, ScannedBoard } from './types';
import { boardExport, downloadJson } from './export';
import { validateLabel } from './labelToBoard';
import './BoardExport.css';

export interface BoardExportProps {
  board?: ScannedBoard | null; // the CURRENT editor board; null while empty
  corners?: Quad | null; // detected scan corners or four hand-clicked corners
}

export const DISABLED_REASON = 'Draw at least one cage on the board to export it.';

const BoardExport: React.FC<BoardExportProps> = ({ board = null, corners = null }) => {
  const [styleTag, setStyleTag] = useState('');
  // The problems, with what they were found for: the editor hands over a fresh
  // board object on every render, so a change is judged by content, and any
  // change hides the list without an effect to clear it.
  const [problems, setProblems] = useState<{ key: string; errors: string[] }>({ key: '', errors: [] });

  const key = JSON.stringify([board, corners, styleTag]);
  const shownErrors = problems.key === key ? problems.errors : [];

  const onExport = () => {
    if (!board) {
      return;
    }
    const tag = styleTag.trim();
    const source: OcrSource = tag ? { kind: 'photo', styleTag: tag } : { kind: 'photo' };
    const { value, filename } = boardExport(board, corners, source);
    const errors = validateLabel(value);
    setProblems({ key, errors });
    if (errors.length === 0) {
      downloadJson(value, filename);
    }
  };

  return (
    <div className="BoardExport">
      <div className="BoardExportActions">
        {corners &&
          <label className="BoardExportField">
            Style tag{' '}
            <input
              type="text"
              data-testid="export-style"
              placeholder="newspaper"
              value={styleTag}
              onChange={(event) => setStyleTag(event.target.value)}
            />
          </label>
        }
        <button
          type="button"
          className="ScanPanelButton"
          data-testid="export-button"
          disabled={!board}
          aria-describedby={board ? undefined : 'export-disabled-reason'}
          onClick={onExport}
        >Export JSON</button>
      </div>

      {!board &&
        <p className="BoardExportReason" id="export-disabled-reason" data-testid="export-disabled-reason">
          {DISABLED_REASON}
        </p>
      }

      {shownErrors.length > 0 &&
        <ul className="ScanPanelErrors" role="alert" data-testid="export-errors">
          {shownErrors.map((error, index) => <li key={index}>{error}</li>)}
        </ul>
      }
    </div>
  );
};

export default BoardExport;
