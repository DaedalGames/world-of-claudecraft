import { afterEach, describe, expect, it } from 'vitest';
import {
  BLADE_COMB_GLSL,
  BLADE_EXTRA_VALUES,
  BLADE_LIGHT_GLSL,
  BLADE_PAINT_VALUES,
  BLADE_RAMP_HI_VALUES,
  BLADE_RAMP_LO_VALUES,
  BLADE_ROUND_FRAGMENT_GLSL,
  BLADE_ROUND_VERTEX_GLSL,
  BLADE_SIZE_VALUES,
  CARPET_GROUND_FAR,
  hexToLinear,
  setBladeCloudZone,
  setBladeExtraZone,
  setBladeRampZone,
  setBladeSizeZone,
} from '../src/render/blade_width_zone_core';
import { LEAF_FLUTTER_GLSL } from '../src/render/foliage_tree_sculpt';

describe('painted meadow light: one-hue ramp, side light, cloud shadows', () => {
  afterEach(() => {
    setBladeRampZone([0, 0, 0], [1, 1, 1], 0, 0);
    setBladeCloudZone(0);
  });

  it('starts off: no ramp, no side light, no clouds', () => {
    expect(BLADE_RAMP_LO_VALUES[3]).toBe(0);
    expect(BLADE_RAMP_HI_VALUES[3]).toBe(0);
    expect(BLADE_PAINT_VALUES[3]).toBe(0);
  });

  it('converts sRGB hex to the linear space vColor lives in', () => {
    expect(hexToLinear(0x000000)).toEqual([0, 0, 0]);
    expect(hexToLinear(0xffffff)).toEqual([1, 1, 1]);
    const [r, g, b] = hexToLinear(0x808080);
    expect(r).toBeCloseTo(0.2158, 3);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });

  it('packs the ramp ends and strengths, clamped, and resets on non-finite input', () => {
    setBladeRampZone([0.1, 0.2, 0.05], [0.4, 0.6, 0.15], 3, -1);
    expect(Array.from(BLADE_RAMP_LO_VALUES)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.05, 6),
      1,
    ]);
    expect(BLADE_RAMP_HI_VALUES[3]).toBe(0);
    setBladeRampZone([Number.NaN, 0, 0], [1, 1, 1], 0.5, 0.5);
    expect(BLADE_RAMP_LO_VALUES[3]).toBe(0);
    setBladeCloudZone(5);
    expect(BLADE_PAINT_VALUES[3]).toBeCloseTo(0.6, 6);
  });

  it('branches every arm out at zero and keeps the blade value under the ramp', () => {
    expect(BLADE_LIGHT_GLSL).toContain('if (uBladeRampLo.w > 0.0)');
    expect(BLADE_LIGHT_GLSL).toContain('if (uBladeRampHi.w > 0.0)');
    expect(BLADE_LIGHT_GLSL).toContain('if (uBladePaint.w > 0.0)');
    expect(BLADE_LIGHT_GLSL).toContain('wocRamp * (wocLum / wocRampLum)');
  });
});

describe('leaf flutter', () => {
  it('only moves leaf materials, and only where the tree wind is on', () => {
    expect(LEAF_FLUTTER_GLSL).toContain('uUpNormalBlend > 0.0 && uWindStrength > 0.0');
  });
});

describe('distance thickening, rounded blades and the far ground tint', () => {
  afterEach(() => {
    setBladeSizeZone(1, 1, 0, 0);
    setBladeExtraZone(0, 0, 0);
  });

  it('defaults both arms off and clamps them', () => {
    setBladeSizeZone(1, 1);
    expect(BLADE_SIZE_VALUES[3]).toBe(0);
    setBladeSizeZone(1, 1, 0, 9);
    expect(BLADE_SIZE_VALUES[3]).toBe(3);
    setBladeExtraZone(1, 0.2);
    expect(BLADE_EXTRA_VALUES[2]).toBe(0);
    setBladeExtraZone(1, 0.2, 4);
    expect(BLADE_EXTRA_VALUES[2]).toBe(1);
  });

  it('branches out at zero and fades warm tips only when thickening is on', () => {
    expect(BLADE_COMB_GLSL).toContain(
      'if (uBladeSize.w > 0.0) transformed.xz *= 1.0 + uBladeSize.w * wocFarT;',
    );
    expect(BLADE_COMB_GLSL).toContain('step(0.0001, uBladeSize.w)');
    expect(BLADE_ROUND_FRAGMENT_GLSL).toContain('if (uBladeExtra.z > 0.0)');
    expect(BLADE_ROUND_VERTEX_GLSL).toBe('vBladeAcross = aBladeAcross;');
  });

  it('tints the far ground darker than the near floor is bright, every channel below 1', () => {
    for (const c of CARPET_GROUND_FAR) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
  });
});
