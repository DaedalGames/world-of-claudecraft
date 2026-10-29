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
 *  gone by 24. */
export const BLADE_NEAR_GLSL = `#ifdef USE_COLOR
          vColor.rgb *= mix(uBladeNear, 1.0, smoothstep(4.0, 24.0, distance(bgOrigin, cameraPosition)));
        #endif`;

// The ground UNDER the near carpet: terrain.ts paints a pale near-grey floor
// inside the carpet ring (GRASS_PAINT_RING_GLSL), which shows between thin
// blades as light ground. A zone look can swap that floor toward a darker
// meadow tone (the meadow paint times CARPET_GROUND_DARK, an RGB multiplier). 0 is the shipped
// pale floor exactly; 1 is the full darker meadow floor.

/** The meadow floor under the carpet at full strength, as an RGB multiplier
 *  on the grass paint: dark and cool, so a gap between tufts reads as shadow
 *  in the grass, never as olive ground. */
export const CARPET_GROUND_DARK: readonly [number, number, number] = [0.36, 0.52, 0.36];

/** The shared uniform the terrain binds (`uCarpetGround`). */
export const CARPET_GROUND_UNIFORM: { value: number } = { value: 0 };

/** Set the zone carpet-floor blend; clamps to 0..1, non-finite restores 0. */
export function setCarpetGroundZone(value: number): void {
  CARPET_GROUND_UNIFORM.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// The windswept comb and the painted field (the art bible's meadow): every
// blade bends toward ONE world direction, so the field reads as combed grass
// lying over itself and closes over the ground; and the field takes large
// light and dark patches plus a warm yellow-green tip, the way a painter lays
// a meadow in broad strokes. Both run at zero at stock (the shipped blades).

/** x,z: world comb direction (normalised in the shader); y: lean strength
 *  (tip offset in cluster units per unit height squared); w: droop (how far
 *  the tip sinks as it leans). Zeros are the shipped upright blades. */
export const BLADE_COMB_VALUES = new Float32Array([0, 0, 0, 0]);
/** x: field patch strength (0..0.5); y: warm-tip strength (0..1); z: clumping
 *  (0..1, blades in a clump share a comb direction, lean, height and shade, the
 *  way Ghost of Tsushima-style fields break into tussocks); w reserved. */
export const BLADE_PAINT_VALUES = new Float32Array([0, 0, 0, 0]);

/** Shared uniforms both blade materials bind (typed arrays reach every clone). */
export const BLADE_COMB_UNIFORM: { value: Float32Array } = { value: BLADE_COMB_VALUES };
export const BLADE_PAINT_UNIFORM: { value: Float32Array } = { value: BLADE_PAINT_VALUES };

/** Set the comb: world direction (x, z), lean strength and droop. Non-finite
 *  values restore the upright blade. */
export function setBladeCombZone(dirX: number, dirZ: number, lean: number, droop: number): void {
  const ok = [dirX, dirZ, lean, droop].every(Number.isFinite);
  BLADE_COMB_VALUES[0] = ok ? dirX : 0;
  BLADE_COMB_VALUES[1] = ok ? Math.min(2, Math.max(0, lean)) : 0;
  BLADE_COMB_VALUES[2] = ok ? dirZ : 0;
  BLADE_COMB_VALUES[3] = ok ? Math.min(1, Math.max(0, droop)) : 0;
}

/** Set the painted field: patch strength, warm-tip strength and clumping (clamped). */
export function setBladePaintZone(patch: number, tip: number, clump = 0): void {
  BLADE_PAINT_VALUES[0] = Number.isFinite(patch) ? Math.min(0.5, Math.max(0, patch)) : 0;
  BLADE_PAINT_VALUES[1] = Number.isFinite(tip) ? Math.min(1, Math.max(0, tip)) : 0;
  BLADE_PAINT_VALUES[2] = Number.isFinite(clump) ? Math.min(1, Math.max(0, clump)) : 0;
}

/** x: blade height scale, y: cluster spread scale (1, 1 is the shipped
 *  cluster); z: view-space widening (0 is off; a blade seen edge-on widens
 *  toward the camera instead of vanishing, after the Ghost of Tsushima grass
 *  talk); w reserved. The carpet's placement no longer reads the palette
 *  lab's meadowHeight/Width (meadow_fullness_core.ts is orphaned), so blade
 *  size is set here, in the shader, for both meadow layers. */
export const BLADE_SIZE_VALUES = new Float32Array([1, 1, 0, 0]);
export const BLADE_SIZE_UNIFORM: { value: Float32Array } = { value: BLADE_SIZE_VALUES };

/** Set the blade size: height and spread scales (0.3..1.6) and widening (0..2). */
export function setBladeSizeZone(height: number, spread: number, widen = 0): void {
  const clamp = (v: number): number => (Number.isFinite(v) ? Math.min(1.6, Math.max(0.3, v)) : 1);
  BLADE_SIZE_VALUES[0] = clamp(height);
  BLADE_SIZE_VALUES[1] = clamp(spread);
  BLADE_SIZE_VALUES[2] = Number.isFinite(widen) ? Math.min(2, Math.max(0, widen)) : 0;
}

/** begin_vertex block (after the width pull, before any fade): comb and paint.
 *  Reads instanceMatrix directly, so it needs no locals from either material. */
export const BLADE_COMB_GLSL = `transformed.y *= uBladeSize.x;
        transformed.xz *= uBladeSize.y;
        #ifdef USE_INSTANCING
        {
          vec2 wocCombXZ = instanceMatrix[3].xz;
          float wocCombJit = fract(sin(dot(wocCombXZ, vec2(12.9898, 78.233))) * 43758.5453);
          float wocCombH = max(position.y, 0.0) * uBladeSize.x;
          // clumps: a smooth world field (tussocks a couple of yards across)
          // that every blade of a clump reads alike
          float wocClumpA = sin(wocCombXZ.x * 0.61 + sin(wocCombXZ.y * 0.47) * 1.9);
          float wocClumpB = sin(wocCombXZ.y * 0.57 + sin(wocCombXZ.x * 0.39) * 2.3);
          float wocClump = uBladePaint.z;
          if (wocClump > 0.0) {
            float wocClumpH = 1.0 + wocClump * 0.22 * wocClumpA * wocClumpB;
            transformed.y *= wocClumpH;
            wocCombH *= wocClumpH;
          }
          if (uBladeSize.z > 0.0) {
            // view-space widening: the view direction in this cluster's frame
            // against the blade's own width axis; edge-on blades widen
            vec3 wocViewL = (cameraPosition - (modelMatrix * vec4(wocCombXZ.x, instanceMatrix[3].y, wocCombXZ.y, 1.0)).xyz)
              * mat3(instanceMatrix);
            float wocEdge = abs(dot(normalize(wocViewL.xz + vec2(1e-4, 0.0)),
              normalize(aBladeSide.xz + vec2(1e-5, 0.0))));
            transformed += aBladeSide * (uBladeSize.z * wocEdge);
          }
          if (uBladeComb.y > 0.0) {
            // the world comb direction, turned per clump, in this cluster's frame
            float wocTurn = wocClump * 0.9 * wocClumpA;
            vec2 wocDir = vec2(uBladeComb.x * cos(wocTurn) - uBladeComb.z * sin(wocTurn),
              uBladeComb.x * sin(wocTurn) + uBladeComb.z * cos(wocTurn));
            vec3 wocCombD = normalize(vec3(wocDir.x, 0.0, wocDir.y) * mat3(instanceMatrix));
            float wocLeanClump = 1.0 + wocClump * 0.35 * wocClumpB;
            float wocCombK = wocCombH * wocCombH * (0.75 + 0.5 * wocCombJit) * wocLeanClump;
            transformed += wocCombD * (uBladeComb.y * wocCombK);
            transformed.y -= uBladeComb.w * wocCombK;
          }
          #ifdef USE_COLOR
          if (uBladePaint.x > 0.0 || uBladePaint.y > 0.0) {
            // broad painted patches: two crossed warped sines over the world
            float wocPatch = sin(wocCombXZ.x * 0.17 + sin(wocCombXZ.y * 0.11) * 2.1)
              * sin(wocCombXZ.y * 0.15 + sin(wocCombXZ.x * 0.09) * 1.8);
            vColor.rgb *= 1.0 + uBladePaint.x * wocPatch + wocClump * 0.1 * wocClumpA * wocClumpB;
            // warm yellow-green tips over the cooler body
            vColor.rgb *= mix(vec3(1.0), vec3(1.3, 1.2, 0.7),
              uBladePaint.y * smoothstep(0.35, 1.0, wocCombH));
          }
          #endif
        }
        #endif`;

// Extra blades and flowers (blade_grass.ts clusterGeometry `extras`): the
// carpet and band tufts carry six finer blades and one tiny daisy, tagged by
// `aBladeKind` (1 extra blade, 2 flower). They collapse to the root unless a
// zone look turns them on, so stock tufts render the shipped nine blades.

/** x: extra blades on (> 0.5); y: share of tufts that show their flower (0..1). */
export const BLADE_EXTRA_VALUES = new Float32Array([0, 0, 0, 0]);
export const BLADE_EXTRA_UNIFORM: { value: Float32Array } = { value: BLADE_EXTRA_VALUES };

/** Set the extras: blades 0..1 (on above 0.5) and the flower share 0..1. */
export function setBladeExtraZone(blades: number, flowers: number): void {
  BLADE_EXTRA_VALUES[0] = Number.isFinite(blades) ? Math.min(1, Math.max(0, blades)) : 0;
  BLADE_EXTRA_VALUES[1] = Number.isFinite(flowers) ? Math.min(1, Math.max(0, flowers)) : 0;
}

/** Last in the instancing block (after sway, so nothing re-inflates a
 *  collapsed vertex): hide disabled extras and give a shown flower its own
 *  colours instead of the ground tint. */
export const BLADE_EXTRA_GLSL = `if (aBladeKind > 0.5) {
            float wocExtraHash = fract(sin(dot(instanceMatrix[3].xz, vec2(41.31, 17.77))) * 23421.631);
            bool wocFlower = aBladeKind > 1.5;
            bool wocShow = wocFlower ? wocExtraHash < uBladeExtra.y : uBladeExtra.x > 0.5;
            if (!wocShow) transformed = vec3(0.0);
            #ifdef USE_COLOR
            if (wocFlower) vColor.rgb = color.rgb;
            #endif
          }`;
