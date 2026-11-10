import { inflateSync } from 'node:zlib';
import { generate } from '../../play/generator/generate';
import { distort } from './distort';
import { crc32, encodePng } from './png';
import { renderPuzzle } from './synth';

interface Chunk {
  type: string;
  data: Uint8Array;
  crc: number;
  computedCrc: number;
}

function parseChunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    chunks.push({ type, data, crc, computedCrc: crc32(png.subarray(offset + 4, offset + 8 + length)) });
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  return chunks;
}

describe('encodePng', () => {
  const rendered = renderPuzzle(generate('png-fixture', 4));
  // Noise makes every row distinct, so a row mix-up cannot pass.
  const { image } = distort(rendered.image, rendered.label.corners, { seed: 'png', tag: 'noise', noise: 0.3 });
  const png = encodePng(image);

  it('starts with the PNG signature', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('writes IHDR, IDAT and IEND with valid CRCs', () => {
    const chunks = parseChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) expect(chunk.crc).toBe(chunk.computedCrc);
    expect(chunks[2].data.length).toBe(0);

    const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, chunks[0].data.byteLength);
    expect(chunks[0].data.length).toBe(13);
    expect(header.getUint32(0)).toBe(image.width);
    expect(header.getUint32(4)).toBe(image.height);
    expect([...chunks[0].data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  });

  it('stores every RGBA row behind filter byte 0', () => {
    const idat = parseChunks(png).find((chunk) => chunk.type === 'IDAT')!;
    const raw = new Uint8Array(inflateSync(idat.data));
    const stride = image.width * 4;
    expect(raw.length).toBe(image.height * (1 + stride));
    for (let y = 0; y < image.height; y++) {
      const start = y * (1 + stride);
      expect(raw[start]).toBe(0);
      const row = raw.subarray(start + 1, start + 1 + stride);
      const expected = new Uint8Array(image.data.buffer, image.data.byteOffset + y * stride, stride);
      if (!Buffer.from(row).equals(Buffer.from(expected))) throw new Error(`row ${y} differs`);
    }
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('rejects a buffer of the wrong size', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(15) })).toThrow();
  });
});
