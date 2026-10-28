import { afterEach, describe, expect, it } from 'vitest';
import {
  BLADE_BASE_GLSL,
  BLADE_BASE_MIN,
  BLADE_BASE_UNIFORM,
  BLADE_NEAR_GLSL,
  BLADE_NEAR_MIN,
  BLADE_NEAR_UNIFORM,
  BLADE_WIDTH_GLSL,
  BLADE_WIDTH_MIN,
  BLADE_WIDTH_UNIFORM,
  CARPET_GROUND_DARK,
  CARPET_GROUND_UNIFORM,
  setBladeBaseZoneShade,
  setBladeNearZoneShade,
  setBladeWidthZoneScale,
  setCarpetGroundZone,
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

describe('near-field meadow shade and carpet floor (zone look arms)', () => {
  afterEach(() => {
    setBladeNearZoneShade(1);
    setCarpetGroundZone(0);
  });

  it('start at the shipped carpet: no near shade, the pale floor', () => {
    expect(BLADE_NEAR_UNIFORM.value).toBe(1);
    expect(CARPET_GROUND_UNIFORM.value).toBe(0);
  });

  it('clamp to their ranges and restore stock on a non-finite value', () => {
    setBladeNearZoneShade(0);
    expect(BLADE_NEAR_UNIFORM.value).toBe(BLADE_NEAR_MIN);
    setBladeNearZoneShade(Number.NaN);
    expect(BLADE_NEAR_UNIFORM.value).toBe(1);
    setCarpetGroundZone(3);
    expect(CARPET_GROUND_UNIFORM.value).toBe(1);
    setCarpetGroundZone(Number.NaN);
    expect(CARPET_GROUND_UNIFORM.value).toBe(0);
  });

  it('the near shade is the identity at 1 in GLSL', () => {
    expect(BLADE_NEAR_GLSL).toContain('mix(uBladeNear, 1.0,');
    expect(CARPET_GROUND_DARK).toBeGreaterThan(0);
    expect(CARPET_GROUND_DARK).toBeLessThan(1);
  });
});
