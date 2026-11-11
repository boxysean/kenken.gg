// "Label a photo", by hand: the scanner's corner detection fails on most real
// photos, so the user clicks the board's four corners instead and draws the
// cages in the editor as usual. The corners go up through onCorners, so the
// solver view's export control (BoardExport) can save the editor board plus
// those corners as an OcrLabel. The corners live here, not in the editor, so
// opening an empty board of the right size does not lose them.
import React, { useEffect, useRef, useState } from 'react';
import type { Point, Quad } from './types';
import { addCorner, clicksToQuad, displayPoint, nextCornerName } from './label/cornersFromClicks';
import type { CornerName, DisplaySize } from './label/cornersFromClicks';
import './LabelPanel.css';

export interface LabelPanelProps {
  onOpenBoard: (boardSize: number) => void; // loads an empty board of that size into the editor
  // The four clicked corners, in photo pixels; null until all four are marked.
  onCorners?: (corners: Quad | null) => void;
}

const CORNER_PROMPT: Record<CornerName, string> = {
  tl: 'Click the top-left corner',
  tr: 'Click the top-right corner',
  br: 'Click the bottom-right corner',
  bl: 'Click the bottom-left corner',
};

const BOARD_SIZES = [4, 5, 6, 7, 8, 9];

const LabelPanel: React.FC<LabelPanelProps> = ({ onOpenBoard, onCorners }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<DisplaySize | null>(null);
  const [clicks, setClicks] = useState<Point[]>([]);
  const [boardSize, setBoardSize] = useState(5);
  // Read through a ref: keyed on the callback, the effect below would fire on
  // every parent render, and each call re-renders the parent.
  const onCornersRef = useRef(onCorners);
  onCornersRef.current = onCorners;

  // Revokes the previous photo's URL when a new one replaces it, and the last on unmount.
  useEffect(() => () => {
    if (src !== null) URL.revokeObjectURL(src);
  }, [src]);

  // Keyed on clicks, not the derived quad, which is a fresh object every render.
  useEffect(() => {
    if (onCornersRef.current) onCornersRef.current(clicksToQuad(clicks));
  }, [clicks]);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files && input.files[0];
    // Clear so picking the same file again still fires a change.
    input.value = '';
    if (!file) {
      return;
    }
    // Corners from the previous photo mean nothing on this one.
    setNatural(null);
    setClicks([]);
    setSrc(URL.createObjectURL(file));
  };

  const onLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setNatural({ width: image.naturalWidth, height: image.naturalHeight });
  };

  const onImageClick = (event: React.MouseEvent<HTMLImageElement>) => {
    // Before load there is no natural size to convert into; a fifth click is
    // ignored by addCorner, but checking here skips the layout read too.
    if (natural === null || clicks.length >= 4) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setClicks(addCorner(clicks, local, { width: rect.width, height: rect.height }, natural));
  };

  const onUndo = () => {
    setClicks(clicks.slice(0, -1));
  };

  const corners = clicksToQuad(clicks);
  const next = nextCornerName(clicks.length);

  return (
    <div className="LabelPanel">
      <button
        type="button"
        className="ScanPanelButton"
        data-testid="label-button"
        onClick={() => inputRef.current && inputRef.current.click()}
      >Label a photo</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="label-input"
        onChange={onChange}
      />

      {src !== null &&
        <>
          <p className="LabelPanelPrompt" data-testid="label-next">
            {next ? CORNER_PROMPT[next] : 'All four corners marked'}
          </p>

          <div className="LabelPanelImageWrap">
            <img
              className="LabelPanelImage"
              src={src}
              alt="The photo being labelled; click its corners"
              data-testid="label-image"
              onLoad={onLoad}
              onClick={onImageClick}
            />
            {natural !== null && clicks.map((point, index) => {
              // Percentages of the natural size track the image however it is
              // scaled, so no resize listener is needed.
              const at = displayPoint(point, { width: 100, height: 100 }, natural);
              return (
                <span
                  key={index}
                  className="LabelPanelMarker"
                  data-testid="label-marker"
                  style={{ left: `${at.x}%`, top: `${at.y}%` }}
                >{index + 1}</span>
              );
            })}
          </div>

          <div className="LabelPanelActions">
            <button
              type="button"
              className="ScanPanelButton"
              data-testid="label-undo"
              disabled={clicks.length === 0}
              onClick={onUndo}
            >Undo</button>
          </div>
        </>
      }

      {corners &&
        <div className="LabelPanelActions">
          <label className="LabelPanelField">
            Board size{' '}
            <select
              data-testid="label-size"
              value={boardSize}
              onChange={(event) => setBoardSize(parseInt(event.target.value, 10))}
            >
              {BOARD_SIZES.map((size) => <option key={size} value={size}>{size}×{size}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="ScanPanelButton"
            data-testid="label-open"
            onClick={() => onOpenBoard(boardSize)}
          >Open in editor</button>
        </div>
      }
    </div>
  );
};

export default LabelPanel;
