import { afterEach, describe, expect, it } from 'vitest';
import {
  BLADE_BASE_GLSL,
  BLADE_BASE_MIN,
  BLADE_BASE_UNIFORM,
  BLADE_WIDTH_GLSL,
  BLADE_WIDTH_MIN,
  BLADE_WIDTH_UNIFORM,
  setBladeBaseZoneShade,
  setBladeWidthZoneScale,
} from '../src/render/blade_width_zone_core';

describe('meadow blade width and root shade (zone look arms)', () => {
  afterEach(() => {
    setBladeWidthZoneScale(1);
    setBladeBaseZoneShade(1);
  });

  it('starts at the shipped blade exactly', () => {
    expect(BLADE_WIDTH_UNIFORM.value).toBe(1);
    expect(BLADE_BASE_UNIFORM.value).toBe(1);
  });

  it('writes the shared uniform objects the blade materials bind by reference', () => {
    setBladeWidthZoneScale(0.55);
    setBladeBaseZoneShade(0.6);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(0.55);
    expect(BLADE_BASE_UNIFORM.value).toBe(0.6);
  });

  it('clamps to the floors and 1, and restores the shipped value on a non-finite one', () => {
    setBladeWidthZoneScale(0);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(BLADE_WIDTH_MIN);
    setBladeWidthZoneScale(2);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(1);
    setBladeBaseZoneShade(-1);
    expect(BLADE_BASE_UNIFORM.value).toBe(BLADE_BASE_MIN);
    setBladeBaseZoneShade(0.5);
    setBladeBaseZoneShade(Number.NaN);
    expect(BLADE_BASE_UNIFORM.value).toBe(1);
  });

  it('is the identity in GLSL at the shipped values (width 1, root shade 1)', () => {
    expect(BLADE_WIDTH_GLSL).toBe('transformed -= aBladeSide * (1.0 - uBladeWidth);');
    expect(BLADE_BASE_GLSL).toContain('mix(uBladeBase, 1.0,');
    expect(BLADE_BASE_GLSL).toContain('#ifdef USE_COLOR');
  });
});
