// "Scan a photo": picks an image, decodes it into the ingest store and previews it.
// Recognition doesn't exist yet, so nothing here touches the solver's board.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OcrImage } from './types';
import { decodeFile, imageToDataUrl } from './ingest/decode';
import * as ingestStore from './ingest/store';
import './ScanButton.css';

export interface ScanStore {
  setImage(image: OcrImage | null): void;
  subscribe(listener: ingestStore.IngestListener): () => void;
}

export interface ScanButtonProps {
  decode?: typeof decodeFile;
  store?: ScanStore;
}

const ScanButton: React.FC<ScanButtonProps> = ({ decode = decodeFile, store = ingestStore }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the latest pick may land: a slow earlier decode must not overwrite it.
  const requestRef = useRef(0);
  const [image, setPreviewImage] = useState<OcrImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => store.subscribe(setPreviewImage), [store]);

  useEffect(() => () => {
    requestRef.current += 1;
  }, []);

  const previewSrc = useMemo(() => (image ? imageToDataUrl(image) : null), [image]);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files && input.files[0];
    // Clear so picking the same file again still fires a change.
    input.value = '';
    if (!file) {
      return;
    }

    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    decode(file).then(
      (decoded) => {
        if (request !== requestRef.current) {
          return;
        }
        setBusy(false);
        store.setImage(decoded);
      },
      (reason: unknown) => {
        if (request !== requestRef.current) {
          return;
        }
        setBusy(false);
        setError(reason instanceof Error && reason.message
          ? reason.message
          : "Couldn't read that photo. Try a different image.");
      },
    );
  };

  return (
    <div className="ScanButton">
      <button
        type="button"
        className="ScanButtonButton"
        data-testid="scan-button"
        disabled={busy}
        onClick={() => inputRef.current && inputRef.current.click()}
      >Scan a photo</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="scan-input"
        onChange={onChange}
      />

      {error &&
        <p className="ScanButtonError" role="alert" data-testid="scan-error">{error}</p>
      }

      {image && !error &&
        <figure className="ScanButtonPreview" data-testid="scan-preview">
          {previewSrc &&
            <img src={previewSrc} alt="Scanned photo preview" width={image.width} height={image.height} />
          }
          <figcaption>{image.width} × {image.height}</figcaption>
        </figure>
      }
    </div>
  );
};

export default ScanButton;
