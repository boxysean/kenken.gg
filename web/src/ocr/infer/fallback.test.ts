// Under jsdom (the app's unit-test environment) a model that cannot be loaded
// must leave the app scanning with the template reader, never broken. Clue crops
// are built from the synthetic renderer exactly as in clueTemplate.test.ts.
import { generate } from '../../play/generator/generate';
import { renderPuzzle } from '../render/synth';
import { deriveCages } from '../pipeline/cages';
import { templateClueReader } from '../pipeline/clueTemplate';
import { warpToBoard } from '../pipeline/warp';
import { makeOnnxReader } from './onnxReader';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeOnnxReader fallback', () => {
  it('warns and reads exactly like the template reader when the model is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = await makeOnnxReader({ modelUrl: '/no/such/model.onnx' });
    expect(warn).toHaveBeenCalled();

    const rendered = renderPuzzle(generate('synth-export-4x4', 4), { tag: 'clean' });
    const crops = deriveCages(warpToBoard(rendered.image, rendered.label.corners), rendered.label).clueCrops;
    expect(crops.length).toBeGreaterThan(0);
    const readings = crops.map(({ crop }) => reader.read(crop));
    expect(readings).toEqual(crops.map(({ crop }) => templateClueReader.read(crop)));
    // Not vacuous: the template reader does read these clean clues.
    expect(readings.some((reading) => reading !== null)).toBe(true);
  });
});
