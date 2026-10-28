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

// Near-field shade: a painter darkens the meadow toward the viewer so the eye
// travels into the scene. The carpet's blades within a few yards of the camera
// take this multiplier, easing back to 1 by mid-field. 1 is the shipped carpet.

/** The darkest a look may take the near meadow. */
export const BLADE_NEAR_MIN = 0.5;

/** The shared uniform the near carpet binds (`uBladeNear`). */
export const BLADE_NEAR_UNIFORM: { value: number } = { value: 1 };

/** Set the zone near-field meadow shade; clamps to BLADE_NEAR_MIN..1, non-finite restores 1. */
export function setBladeNearZoneShade(value: number): void {
  BLADE_NEAR_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_NEAR_MIN, value))
    : 1;
}

/** Near-field shade over the camera distance of the blade's instance origin
 *  (begin_vertex, where the carpet already has `bgOrigin`). Full at 4 yards,
 *  gone by 17. */
export const BLADE_NEAR_GLSL = `#ifdef USE_COLOR
          vColor.rgb *= mix(uBladeNear, 1.0, smoothstep(4.0, 17.0, distance(bgOrigin, cameraPosition)));
        #endif`;

// The ground UNDER the near carpet: terrain.ts paints a pale near-grey floor
// inside the carpet ring (GRASS_PAINT_RING_GLSL), which shows between thin
// blades as light ground. A zone look can swap that floor toward a darker
// meadow tone (the meadow paint times CARPET_GROUND_DARK). 0 is the shipped
// pale floor exactly; 1 is the full darker meadow floor.

/** How dark the meadow floor under the carpet goes at full strength. */
export const CARPET_GROUND_DARK = 0.72;

/** The shared uniform the terrain binds (`uCarpetGround`). */
export const CARPET_GROUND_UNIFORM: { value: number } = { value: 0 };

/** Set the zone carpet-floor blend; clamps to 0..1, non-finite restores 0. */
export function setCarpetGroundZone(value: number): void {
  CARPET_GROUND_UNIFORM.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
