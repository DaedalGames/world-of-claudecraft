// @vitest-environment happy-dom
// The editor's terrain material always carries the texture-paint path
// (terrain_paint_layers.ts paintLayerRuntimeForMaterial): on a map with no
// textured swatch yet it compiles against a DORMANT runtime (paint off, one
// neutral layer), so the first textured swatch swaps onto the live material
// (swapPaintLayerRuntime) instead of forcing the full terrain rebuild that froze
// a world-size map for seconds and tore down the terrain and far vista. The game
// keeps its exact shader: no texture paint, no paint path.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { attachPaintPath, swapPaintLayerRuntime } from '../src/render/terrain';
import {
  invalidatePaintLayerRuntime,
  isDormantPaintTexture,
  paintLayerRuntime,
  paintLayerRuntimeForMaterial,
  setPaintPathAlways,
} from '../src/render/terrain_paint_layers';
import { setActiveWorldContent } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';

afterEach(() => {
  setPaintPathAlways(false);
  setActiveWorldContent(null);
  invalidatePaintLayerRuntime();
});

function contentWithPaint(textured: boolean): WorldContent {
  return {
    zones: [],
    camps: [],
    npcs: {},
    groundObjects: [],
    roads: [],
    props: [],
    playerStart: { x: 0, z: 0 },
    biomePaint: {
      cell: 1,
      cols: 4,
      rows: 4,
      originX: 0,
      originZ: 0,
      ids: new Array(16).fill(255).map((v, i) => (i === 5 ? 64 : v)),
      custom: [
        textured
          ? { id: 64, color: 0x887766, textureSha: 'a'.repeat(64), tileSize: 14 }
          : { id: 64, color: 0x887766 },
      ],
    },
  } as unknown as WorldContent;
}

describe('the terrain material paint runtime', () => {
  it('keeps the game shader: no texture paint and no request means no paint path', () => {
    const rt = paintLayerRuntimeForMaterial();
    expect(rt.field).toBeNull();
    expect(rt.tiles).toBeNull();
  });

  it('compiles a dormant paint path when a host asks for it on an unpainted map', () => {
    setPaintPathAlways(true);
    const rt = paintLayerRuntimeForMaterial();
    expect(rt.field).not.toBeNull();
    expect(rt.tiles).not.toBeNull();
    expect(rt.normTiles).not.toBeNull();
    expect(rt.aoTiles).not.toBeNull();
    // Off: the fragment never samples the placeholder layers.
    expect(rt.on.value).toBe(0);
    expect(rt.tiles?.image.depth).toBe(1);
    expect(rt.field?.image.width).toBe(1);
    // Zero slots in the grid: nothing reads as painted.
    expect(rt.grid.w).toBe(0);
  });

  it('shares one dormant set across builds and marks it, so no build strands textures', () => {
    setPaintPathAlways(true);
    const a = paintLayerRuntimeForMaterial();
    const b = paintLayerRuntimeForMaterial();
    expect(b.field).toBe(a.field);
    for (const tex of [a.field, a.tiles, a.normTiles, a.aoTiles]) {
      expect(isDormantPaintTexture(tex)).toBe(true);
    }
    expect(isDormantPaintTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1))).toBe(false);
  });

  it('uses the live runtime whenever the map carries texture paint, asked or not', () => {
    setActiveWorldContent(contentWithPaint(true));
    invalidatePaintLayerRuntime();
    const live = paintLayerRuntime();
    expect(live.field).not.toBeNull();
    expect(paintLayerRuntimeForMaterial()).toBe(live);
    setPaintPathAlways(true);
    expect(paintLayerRuntimeForMaterial()).toBe(live);
  });

  it('colour-only paint still compiles dormant when asked, since no texture slot exists yet', () => {
    setActiveWorldContent(contentWithPaint(false));
    invalidatePaintLayerRuntime();
    setPaintPathAlways(true);
    const rt = paintLayerRuntimeForMaterial();
    expect(rt.field).not.toBeNull();
    expect(rt.on.value).toBe(0);
  });
});

// The splat material's paint path (terrain.ts attachPaintPath, which
// buildSplatMaterial calls) and the live swap: with the host switch on, a map
// with no texture paint still gets the path, so the first textured swatch
// swaps in (swapPaintLayerRuntime true, no rebuild); without it there is no
// path and only the full rebuild can show the texture, as the game always did.
describe('the first textured swatch on a built splat material', () => {
  function firstSwatchSwaps(pathAlways: boolean): boolean {
    setPaintPathAlways(pathAlways);
    setActiveWorldContent(contentWithPaint(false));
    invalidatePaintLayerRuntime();
    const mat = new THREE.MeshStandardMaterial();
    const attached = attachPaintPath(mat);
    expect(attached !== null).toBe(pathAlways);
    let dormantDisposed = false;
    attached?.uPaintField.value?.addEventListener('dispose', () => {
      dormantDisposed = true;
    });
    // The maker adds the map's first textured swatch.
    setActiveWorldContent(contentWithPaint(true));
    invalidatePaintLayerRuntime();
    const swapped = swapPaintLayerRuntime(mat);
    if (swapped) {
      const live = paintLayerRuntime();
      const u = mat.userData.paintUniforms;
      expect(u.uPaintField.value).toBe(live.field);
      expect(u.uPaintAoTiles.value).toBe(live.aoTiles);
      // The shared dormant set survives the swap for the next build.
      expect(dormantDisposed).toBe(false);
    }
    return swapped;
  }

  it('swaps in live when the host compiled the paint path', () => {
    expect(firstSwatchSwaps(true)).toBe(true);
  });

  it('needs the full rebuild without it, as the game path always did', () => {
    expect(firstSwatchSwaps(false)).toBe(false);
  });
});
