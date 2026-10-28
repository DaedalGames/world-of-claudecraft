// Per-zone blade width for the meadow (the near carpet, blade_grass.ts, and the
// mid band, blade_grass_band.ts). One shared uniform object, read by reference
// by both materials: the vertex shader pulls each blade's edge vertices toward
// its spine by this factor, so a zone look can thin the wide shipped ribbons
// into a finer painterly carpet without rebuilding a single cluster. The
// palette runtime writes the look's `render.bladeWidth`, eased across zone
// borders. 1 is the shipped blade exactly. Three-free so a plain Vitest pins it.

/** The narrowest a look may thin a blade (a hair-thin blade reads as noise). */
export const BLADE_WIDTH_MIN = 0.3;

/** The shared uniform the blade materials bind (`uBladeWidth`). */
export const BLADE_WIDTH_UNIFORM: { value: number } = { value: 1 };

/** Set the zone blade width; clamps to BLADE_WIDTH_MIN..1, non-finite restores 1. */
export function setBladeWidthZoneScale(value: number): void {
  BLADE_WIDTH_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_WIDTH_MIN, value))
    : 1;
}

/** The GLSL statement that narrows a blade (spliced first in begin_vertex). */
export const BLADE_WIDTH_GLSL = 'transformed -= aBladeSide * (1.0 - uBladeWidth);';

// The blade ROOT shade, the same way: the carpet's vertex colours brighten base
// to tip, and a zone look can deepen the base so a dense near meadow, seen from
// above, shows its shaded body (darker toward the camera) while distant grass
// shows only its lit tips. 1 is the shipped shade exactly.

/** The darkest a look may take a blade root. */
export const BLADE_BASE_MIN = 0.4;

/** The shared uniform the blade materials bind (`uBladeBase`). */
export const BLADE_BASE_UNIFORM: { value: number } = { value: 1 };

/** Set the zone blade-root shade; clamps to BLADE_BASE_MIN..1, non-finite restores 1. */
export function setBladeBaseZoneShade(value: number): void {
  BLADE_BASE_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_BASE_MIN, value))
    : 1;
}

/** The GLSL statement that deepens a blade root (after color_vertex). The blade
 *  rises to about one yard in model space, so the shade recovers by mid-blade. */
export const BLADE_BASE_GLSL = `#ifdef USE_COLOR
          vColor.rgb *= mix(uBladeBase, 1.0, smoothstep(0.0, 0.6, position.y));
        #endif`;
