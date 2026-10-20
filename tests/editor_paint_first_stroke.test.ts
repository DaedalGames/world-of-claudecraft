// @vitest-environment happy-dom
// The first Paint Biome stroke on an unpainted map, through the real
// EditorApp.ensureBiomeGrid path. A new, empty grid changes nothing on screen:
// built-in ground paint lands through the chunk vertex tints the stroke's own
// region rebuild rewrites, and textured paint brings its own full rebuild when
// its first swatch is added (terrain.ts). The full rebuild it used to request
// re-fit every water sheet, re-seated every asset (seconds on a world-size map)
// and tore down the whole terrain and far vista, so the scene sat in close fog
// until they streamed back, then visibly cleared: the freeze, then the whole
// screen changing colour.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorApp } from '../src/editor/app';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { getContentGeneration } from '../src/sim/data';

afterEach(() => vi.restoreAllMocks());

function appHarness() {
  const map = newFlatCustomMap('Paint check', 'paint-check', 42);
  const viewport3d = {
    rebuildTerrainFull: vi.fn(),
    rebuildTerrainRegion: vi.fn(),
    finishTerrainStroke: vi.fn(),
  };
  const activeWorld: { biomePaint?: unknown } = {};
  const app = Object.assign(Object.create(EditorApp.prototype), {
    map,
    activeWorld,
    viewport3d,
    paintCreatedGrid: false,
  }) as {
    map: typeof map;
    activeWorld: typeof activeWorld;
    paintCreatedGrid: boolean;
    ensureBiomeGrid(): void;
  };
  return { app, viewport3d };
}

describe('the first Paint Biome stroke', () => {
  it('creates an unpainted grid and rebuilds nothing', () => {
    const { app, viewport3d } = appHarness();
    expect(app.map.biomePaint).toBeUndefined();
    app.ensureBiomeGrid();
    const grid = app.map.biomePaint;
    if (!grid) throw new Error('no grid');
    expect(app.activeWorld.biomePaint).toBe(grid);
    expect(grid.ids.length).toBe(grid.cols * grid.rows);
    expect(grid.ids.every((id) => id === 255)).toBe(true);
    expect(app.paintCreatedGrid).toBe(true);
    expect(viewport3d.rebuildTerrainFull).not.toHaveBeenCalled();
    expect(viewport3d.rebuildTerrainRegion).not.toHaveBeenCalled();
    expect(viewport3d.finishTerrainStroke).not.toHaveBeenCalled();
  });

  it('tells the off-thread meshers the content changed, so they see the grid', () => {
    const { app } = appHarness();
    const before = getContentGeneration();
    app.ensureBiomeGrid();
    expect(getContentGeneration()).toBeGreaterThan(before);
  });

  it('does nothing the second time: the grid exists', () => {
    const { app, viewport3d } = appHarness();
    app.ensureBiomeGrid();
    const grid = app.map.biomePaint;
    const generation = getContentGeneration();
    app.ensureBiomeGrid();
    expect(app.map.biomePaint).toBe(grid);
    expect(getContentGeneration()).toBe(generation);
    expect(viewport3d.rebuildTerrainFull).not.toHaveBeenCalled();
  });
});
