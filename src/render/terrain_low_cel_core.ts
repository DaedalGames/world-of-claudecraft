// Pure core for the Low-tier (Lambert) stylized cel-shaded ground look.
//
// Why this exists:
// - The Low tier (!GFX.terrainSplat, lowPlus, and iOS/mobile fallback) cannot
//   spend the 15 texture samplers or multi-megabyte photo arrays of the PBR
//   splat shader, and its chunk mesh uses coarse 3.0 to 6.5 yard vertex
//   spacing.
// - Previously, buildLambertMaterial multiplied vertex colours by a single
//   grey canvas speckled with random 1-3px grey dots and ignored per-vertex
//   splat weights (aSplat). That darkened the ground by ~18%, gave grass,
//   dirt, rock, and sand the exact same concrete-dot noise, and left 3 to 6.5
//   yard diagonal triangle sawteeth along every road and cliff border.
//
// This module packs FOUR distinct, tileable, zero-mean cel-art patterns into
// the single RGBA `map` texture MeshLambertMaterial already binds (zero added
// sampler uniforms), and patches the Lambert shader to:
//   1. Pass `aSplat` ([grass, dirt, rock, sand] weights already computed by
//      sampleVertex) to the fragment shader.
//   2. Reshape road and rock transition edges per-pixel using the pebble (G)
//      and rock-plate (B) channels so coarse triangle sawteeth become crisp,
//      organic painted borders with a subtle turf-lip shadow.
//   3. Modulate each material layer between a warm sunlit highlight tint and a
//      cool shadow recess tint through an odd cubic cel-step curve centered on
//      zero, so mipmaps average strictly to 1.0 at distance with no darkening.
//   4. Project steep cliff walls triplanarly (XY/ZY) so mountainsides show
//      polygonal rock plates and strata instead of vertically stretched turf.

export const LOW_CEL_GROUND_SIZE = 256;
export const LOW_CEL_GROUND_PATCH_MARKER = 'WOC_LOW_CEL_GROUND';

const NEUTRAL_BYTE = 128;
const TARGET_CHANNEL_SD = 48;

function wrapGrid(i: number, period: number): number {
  const m = i % period;
  return m < 0 ? m + period : m;
}

/** Deterministic 32-bit avalanche hash on a periodic (ix, iy) lattice in [0, 1). */
export function periodicCellHash(ix: number, iy: number, period: number, seed: number): number {
  const wx = wrapGrid(ix, period);
  const wy = wrapGrid(iy, period);
  let h = (Math.imul(wx, 0x9e3779b1) ^ Math.imul(wy, 0x85ebca77) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Seamless periodic value noise on a `period x period` lattice in [0, 1). */
function periodicValueNoise(u: number, v: number, period: number, seed: number): number {
  const gx = u * period;
  const gy = v * period;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = periodicCellHash(ix, iy, period, seed);
  const n10 = periodicCellHash(ix + 1, iy, period, seed);
  const n01 = periodicCellHash(ix, iy + 1, period, seed);
  const n11 = periodicCellHash(ix + 1, iy + 1, period, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

interface WorleySample {
  f1: number;
  f2: number;
  dx: number;
  dy: number;
  cellTone: number;
}

/** Seamless periodic Worley/Voronoi cellular query on a `period x period` grid. */
function periodicWorley(
  u: number,
  v: number,
  period: number,
  jitter: number,
  seed: number,
): WorleySample {
  const gx = u * period;
  const gy = v * period;
  const baseX = Math.floor(gx);
  const baseY = Math.floor(gy);
  let f1 = 1e9;
  let f2 = 1e9;
  let bestDx = 0;
  let bestDy = 0;
  let bestTone = 0.5;
  for (let oy = -1; oy <= 1; oy++) {
    const cy = baseY + oy;
    for (let ox = -1; ox <= 1; ox++) {
      const cx = baseX + ox;
      const jx = (periodicCellHash(cx, cy, period, seed) - 0.5) * jitter;
      const jy = (periodicCellHash(cx, cy, period, seed + 101) - 0.5) * jitter;
      const px = cx + 0.5 + jx;
      const py = cy + 0.5 + jy;
      const dx = gx - px;
      const dy = gy - py;
      const d = Math.hypot(dx, dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        bestDx = dx;
        bestDy = dy;
        bestTone = periodicCellHash(cx, cy, period, seed + 211);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, dx: bestDx, dy: bestDy, cellTone: bestTone };
}

/**
 * Stylized grass tuft and brushstroke signal at normalized tile UV (u, v).
 * Combines swept anisotropic brushstrokes with a cellular lattice of 3-blade
 * grass tufts (dark root crescent at the base, bright blade tips above).
 */
function sampleCelGrassPattern(u: number, v: number): number {
  const warpX = periodicValueNoise(u, v, 3, 0x101) - 0.5;
  const warpY = periodicValueNoise(u, v, 3, 0x202) - 0.5;
  // Isotropic domain-warped meadow patches (no directional shear that could stripe)
  const su = u + 0.19 + warpX * 0.12;
  const sv = v + 0.43 + warpY * 0.12;
  const patchCoarse = periodicValueNoise(su, sv, 4, 0x303);
  const patchMid = periodicValueNoise(su + 0.31, sv + 0.17, 8, 0x404);
  const brushPatch = smoothstep(0.22, 0.78, patchCoarse * 0.58 + patchMid * 0.42);

  // Primary bold 3-blade grass tuft clusters on a 10x10 periodic lattice (~25px/cell)
  const tuftCell = periodicWorley(
    u + 0.29 + warpX * 0.03,
    v + 0.61 + warpY * 0.03,
    10,
    0.78,
    0x505,
  );
  const fanWidth = Math.max(0.18, 0.25 + (tuftCell.dy + 0.22) * 0.65);
  const nx = tuftCell.dx / fanWidth;
  const ny = (tuftCell.dy + 0.05) / 0.44;
  const inCrown = Math.max(0, 1 - Math.hypot(nx * 0.82, ny));
  const ribs = 0.5 + 0.5 * Math.cos(nx * Math.PI * 2.4);
  const bladeHighlight =
    smoothstep(0.12, 0.62, inCrown * (0.52 + 0.48 * ribs)) * (0.58 + 0.42 * tuftCell.cellTone);
  // Crisp dark root pocket right under the tuft base
  const rootShadow = smoothstep(
    0.42,
    0.05,
    Math.hypot(tuftCell.dx * 1.25, (tuftCell.dy + 0.27) * 2.1),
  );

  // Secondary staggered tuft lattice (17x17) for fine near-camera blade and clover breakup
  const fineTuft = periodicWorley(u + 0.73, v + 0.19, 17, 0.8, 0x555);
  const fineCrown = Math.max(0, 1 - Math.hypot(fineTuft.dx * 1.8, (fineTuft.dy + 0.04) * 2.1));
  const fineRoot = smoothstep(0.36, 0.06, Math.hypot(fineTuft.dx * 1.4, (fineTuft.dy + 0.25) * 2.2));
  const cloverAccent =
    smoothstep(0.72, 0.94, fineTuft.cellTone) * (1 - smoothstep(0.0, 0.34, fineTuft.f1));

  return (
    brushPatch * 0.38 +
    bladeHighlight * 0.42 -
    rootShadow * 0.36 +
    (fineCrown * 0.22 - fineRoot * 0.18) +
    cloverAccent * 0.16
  );
}

/**
 * Stylized packed-earth, soil-clod, and embedded-gravel trail pattern at (u, v).
 * Combines organic soil mounds and footworn hollows with scattered embedded stones
 * (gated by cellTone so trails read as natural packed earth with stones rather
 * than wall-to-wall giant Voronoi bubbles) plus fine gravel grit.
 */
function sampleCelDirtPattern(u: number, v: number): number {
  const warpX = periodicValueNoise(u, v, 4, 0x606) - 0.5;
  const warpY = periodicValueNoise(u + 0.41, v + 0.19, 4, 0x656) - 0.5;
  const du = u + warpX * 0.06;
  const dv = v + warpY * 0.06;

  // Multi-scale packed-earth soil mounds and damp hollows
  const soilCoarse = periodicValueNoise(du + 0.11, dv + 0.47, 4, 0x909);
  const soilMid = periodicValueNoise(du + 0.63, dv + 0.29, 8, 0x959);
  const soilWave = smoothstep(0.18, 0.82, soilCoarse * 0.58 + soilMid * 0.42);

  // Soft crumbled earth clods (9x9)
  const clods = periodicWorley(du + 0.23, dv + 0.51, 9, 0.82, 0x707);
  const clodCrevice = smoothstep(0.02, 0.22, clods.f2 - clods.f1);
  const clodDome = 1 - smoothstep(0.06, 0.52, clods.f1);
  const clodBody = clodCrevice * (0.42 + clodDome * 0.36 + clods.cellTone * 0.22);

  // Scattered embedded trail stones (14x14): gated by cellTone so only a subset of
  // cells form distinct protruding pebbles embedded in the soil matrix.
  const pebbles = periodicWorley(du + 0.53, dv + 0.19, 14, 0.84, 0x808);
  const pebblePresence = smoothstep(0.34, 0.82, pebbles.cellTone);
  const pebbleRim = smoothstep(0.025, 0.17, pebbles.f2 - pebbles.f1);
  const pebbleCap = 1 - smoothstep(0.04, 0.44, pebbles.f1);
  const embeddedPebbles = pebblePresence * (pebbleRim * (0.5 + 0.5 * pebbleCap) - (1 - pebbleRim) * 0.35);

  // Fine compacted grit (22x22)
  const grit = periodicWorley(u + 0.79, v + 0.33, 22, 0.82, 0x888);
  const gritGrain = smoothstep(0.02, 0.16, grit.f2 - grit.f1) * (0.45 + 0.55 * grit.cellTone);

  return soilWave * 0.34 + clodBody * 0.30 + embeddedPebbles * 0.22 + gritGrain * 0.18;
}

/**
 * Stylized polygonal rock fracture plates and cliff strata at (u, v).
 * Sharp Voronoi plate borders, per-plate flat facet bevels, secondary fissures,
 * and horizontal geological strata ledges.
 */
function sampleCelRockPattern(u: number, v: number): number {
  const warp = periodicValueNoise(u, v, 3, 0xa0a) - 0.5;
  const plates = periodicWorley(u + 0.41 + warp * 0.05, v + 0.23 + warp * 0.03, 6, 0.82, 0xb0b);
  const majorCrack = smoothstep(0.025, 0.16, plates.f2 - plates.f1);
  const bevel = Math.max(0, Math.min(1, 0.5 + plates.dx * 0.55 + plates.dy * 0.75));
  const steppedTone = smoothstep(0.18, 0.82, plates.cellTone * 0.65 + bevel * 0.35);

  const subPlates = periodicWorley(u + 0.67, v + 0.83, 13, 0.8, 0xc0c);
  const minorCrack = smoothstep(0.02, 0.12, subPlates.f2 - subPlates.f1);

  const strataPhase = v * 5 + u * 1.0 + warp * 0.55 + (plates.cellTone - 0.5) * 0.25;
  const strataWave = 0.5 + 0.5 * Math.sin(strataPhase * Math.PI * 2);
  const strataLedge = smoothstep(0.22, 0.78, strataWave);

  return majorCrack * (0.32 + steppedTone * 0.68) * 0.56 + minorCrack * 0.22 + strataLedge * 0.22;
}

/**
 * Stylized wind-swept sand ripples, shingle flecks, and low-frequency drift at (u, v).
 */
function sampleCelSandPattern(u: number, v: number): number {
  const phaseWarp = periodicValueNoise(u, v, 4, 0xd0d) - 0.5;
  const rippleArg = (u * 2 + v * 8 + phaseWarp * 0.42) * Math.PI * 2;
  const rippleRaw = 0.5 + 0.5 * Math.sin(rippleArg);
  // Asymmetric crest/trough profile for wind-blown sand ripples
  const ripple = rippleRaw * rippleRaw * (2 - rippleRaw);
  const crossArg = (u * 5 - v * 11 + phaseWarp * 0.35) * Math.PI * 2;
  const crossRipple = 0.5 + 0.5 * Math.sin(crossArg);
  const shingle = periodicWorley(u + 0.47, v + 0.81, 18, 0.82, 0xd8d);
  const shellFleck =
    smoothstep(0.68, 0.95, shingle.cellTone) * (1 - smoothstep(0.0, 0.36, shingle.f1));
  const macro = periodicValueNoise(u + 0.27, v + 0.63, 4, 0xe0e);
  return ripple * 0.46 + crossRipple * 0.14 + shellFleck * 0.14 + macro * 0.26;
}

const bakedRgbaCache = new Map<number, Uint8Array>();

/**
 * Bake the 4-channel RGBA cel ground pattern buffer (`size x size x 4` bytes).
 * Every channel is normalized across the full periodic tile to exact mean 128
 * (`0.50196`) so hardware mipmaps decay smoothly to neutral at the horizon.
 */
export function bakeLowCelGroundRgba(size: number = LOW_CEL_GROUND_SIZE): Uint8Array {
  if (!Number.isInteger(size) || size < 8 || (size & (size - 1)) !== 0) {
    throw new Error(`LOW_CEL_GROUND_SIZE must be a power of two >= 8 (got ${size})`);
  }
  const hit = bakedRgbaCache.get(size);
  if (hit) return hit.slice();
  const pixelCount = size * size;
  const raw = new Float32Array(pixelCount * 4);
  const invSize = 1 / size;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * invSize;
    const rowOffset = y * size * 4;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * invSize;
      const idx = rowOffset + x * 4;
      raw[idx] = sampleCelGrassPattern(u, v);
      raw[idx + 1] = sampleCelDirtPattern(u, v);
      raw[idx + 2] = sampleCelRockPattern(u, v);
      raw[idx + 3] = sampleCelSandPattern(u, v);
    }
  }

  const out = new Uint8Array(pixelCount * 4);
  for (let ch = 0; ch < 4; ch++) {
    let sum = 0;
    for (let i = ch; i < raw.length; i += 4) sum += raw[i];
    const mean = sum / pixelCount;

    let sqSum = 0;
    for (let i = ch; i < raw.length; i += 4) {
      const d = raw[i] - mean;
      sqSum += d * d;
    }
    const sd = Math.sqrt(sqSum / pixelCount) || 1;
    const scale = TARGET_CHANNEL_SD / sd;

    // First quantization pass centered at NEUTRAL_BYTE (128).
    let qSum = 0;
    for (let i = ch; i < raw.length; i += 4) {
      const centered = (raw[i] - mean) * scale;
      const b = Math.max(8, Math.min(248, Math.round(NEUTRAL_BYTE + centered)));
      out[i] = b;
      qSum += b;
    }
    // Residual DC correction so the quantized byte mean is within 0.5 of 128.
    const residual = Math.round(NEUTRAL_BYTE - qSum / pixelCount);
    if (residual !== 0) {
      for (let i = ch; i < out.length; i += 4) {
        out[i] = Math.max(4, Math.min(252, out[i] + residual));
      }
    }
  }
  bakedRgbaCache.set(size, out);
  return out.slice();
}

function glslFloat(value: number): string {
  const text = String(Number(value.toFixed(2)));
  return text.includes('.') ? text : `${text}.0`;
}

/**
 * The GLSL fragment block injected after `#include <color_fragment>` on the
 * Low-tier Lambert terrain material.
 */
export function lowCelLambertColorFragmentGlsl(waterLevel: number): string {
  const wetLow = glslFloat(waterLevel + 0.1);
  const wetHigh = glslFloat(waterLevel + 1.6);
  return `#include <color_fragment>
        // ${LOW_CEL_GROUND_PATCH_MARKER}
        #ifdef USE_MAP
        {
          // Curtain and cut-rim normal correction (mirrors buildSplatMaterial):
          // chunk skirts and boolean-cut rims copy the surface vertex normal straight
          // down a vertical face, so |shade.y| - |geo.y| detects lying curtain normals
          // and switches to the true geometric triangle normal without affecting coarse hills.
          vec3 wocShadeN = normalize( vWocWNorm );
          vec3 wocGeoRaw = cross( dFdx( vWocWPos ), dFdy( vWocWPos ) );
          vec3 wocGeoN = length( wocGeoRaw ) > 1e-12 ? normalize( wocGeoRaw ) : wocShadeN;
          if ( dot( wocGeoN, wocShadeN ) < 0.0 ) wocGeoN = -wocGeoN;
          vec3 wocWN = normalize( mix(
            wocShadeN,
            wocGeoN,
            smoothstep( 0.35, 0.65, abs( wocShadeN.y ) - abs( wocGeoN.y ) )
          ) );

          // Three incommensurable world-planar octaves from the single 256x256 RGBA map:
          // fine (4.54yd), 37deg-rotated mid (7.57yd), and 53deg-rotated macro (13.8yd)
          // so neither meadows nor straight roads ever show a periodic tile repeat.
          vec2 wocUv = vWocWPos.xz * 0.22;
          vec2 wocMidUv = vec2(
            wocUv.x * 0.48 - wocUv.y * 0.36,
            wocUv.x * 0.36 + wocUv.y * 0.48
          ) + vec2( 0.61, 0.23 );
          vec2 wocMacroUv = vec2(
            wocUv.x * 0.20 - wocUv.y * 0.26,
            wocUv.x * 0.26 + wocUv.y * 0.20
          ) + vec2( 0.37, 0.71 );
          vec4 wocPatFine = texture2D( map, wocUv ) - ( 128.0 / 255.0 );
          vec4 wocPatMid = texture2D( map, wocMidUv ) - ( 128.0 / 255.0 );
          vec4 wocPatMacro = texture2D( map, wocMacroUv ) - ( 128.0 / 255.0 );

          // Spatially varying octave blend driven by the macro field (mirrors buildSplatMaterial)
          vec4 wocOctBlend = clamp( vec4( 0.42 ) + wocPatMacro.gbar * 0.75, 0.15, 0.75 );
          vec4 wocPatMix = mix( wocPatFine, wocPatMid, wocOctBlend );

          // Anti-corduroy triplanar wall projection (mirrors buildSplatMaterial):
          // ZY plane swaps axes (vWocWPos.yz) for a 90deg rotation so X and Z walls never
          // share stripe alignment at cliff corners; steep dirt banks also project onto walls.
          vec3 wocAbsN = abs( wocWN );
          float wocWallW = 1.0 - smoothstep( 0.46, 0.80, wocAbsN.y );
          float wocDirtWallW = smoothstep( 0.12, 0.44, 1.0 - wocAbsN.y );
          float wocAxisX = wocAbsN.x / max( 1e-4, wocAbsN.x + wocAbsN.z );
          float wocRockWall = wocPatMix.b;
          float wocDirtWall = wocPatMix.g;
          float wocWallCav = 0.0;
          if ( ( vWocSplat.z * wocWallW + vWocSplat.y * wocDirtWallW ) > 0.015 ) {
            vec2 wocWallUv = mix( vWocWPos.xy, vWocWPos.yz, wocAxisX ) * 0.165;
            vec2 wocWallCoarseUv = mix( vWocWPos.xy, vWocWPos.yz, wocAxisX ) * 0.055 + vec2( 0.29, 0.53 );
            vec4 wocWallTap = texture2D( map, wocWallUv ) - ( 128.0 / 255.0 );
            vec4 wocWallCoarse = texture2D( map, wocWallCoarseUv ) - ( 128.0 / 255.0 );
            float wocPlateMix = clamp( 0.52 + wocPatMacro.r * 0.65, 0.20, 0.82 );
            float wocStrata = sin( vWocWPos.y * 0.82 + wocPatMacro.b * 4.2 ) * 0.14;
            wocRockWall = mix( wocWallTap.b, wocWallCoarse.b, wocPlateMix ) * 0.86
                        + wocWallTap.g * 0.24
                        + wocStrata;
            wocDirtWall = mix( wocWallTap.g, wocWallCoarse.g, 0.40 );
            wocWallCav = wocWallCoarse.b;
          }

          // Border-weighted splat reshaping + competitive height blending (wocHW):
          // Perturb vWocSplat only in active transition bands (4 * s * (1 - s)) so broad
          // dry meadow patches (vWocSplat.y ~ 0.15..0.35) and road forks keep their exact
          // coverage, while road and cliff borders interlock at clod/plate scale.
          float wocDirtEdgeNoise = wocPatMix.g * 0.34 + wocPatMacro.g * 0.16;
          float wocRockEdgeNoise = mix( wocPatMix.b, wocRockWall, wocWallW ) * 0.34 + wocPatMacro.b * 0.16;
          float wocDirtBorder = vWocSplat.y * ( 1.0 - vWocSplat.y ) * 4.0;
          float wocRockBorder = vWocSplat.z * ( 1.0 - vWocSplat.z ) * 4.0;
          float wocDirtSharp = clamp(
            vWocSplat.y + wocDirtBorder * ( wocDirtEdgeNoise + ( vWocSplat.y - 0.44 ) * 0.38 ),
            0.0,
            1.0
          );
          float wocRockSharp = clamp(
            vWocSplat.z + wocRockBorder * ( wocRockEdgeNoise + ( vWocSplat.z - 0.46 ) * 0.42 ),
            0.0,
            1.0
          );
          vec4 wocSplatR = vec4(
            max( 0.0, vWocSplat.x - ( wocDirtSharp - vWocSplat.y ) - ( wocRockSharp - vWocSplat.z ) ),
            wocDirtSharp,
            wocRockSharp,
            vWocSplat.w
          );
          float wocSplatSum = wocSplatR.x + wocSplatR.y + wocSplatR.z + wocSplatR.w;
          wocSplatR = wocSplatSum > 0.001 ? wocSplatR / wocSplatSum : vec4( 1.0, 0.0, 0.0, 0.0 );

          // Competitive height blend (mirrors buildSplatMaterial heightBlend):
          // stones poke through soil and grass tufts poke into trail margins at transitions.
          vec4 wocH4 = vec4(
            wocPatMix.r,
            mix( wocPatMix.g, wocDirtWall, wocDirtWallW ),
            mix( wocPatMix.b, wocRockWall, wocWallW ),
            wocPatMix.a
          );
          vec4 wocE = wocSplatR + wocH4 * 0.48;
          wocE = mix( vec4( -2.0 ), wocE, step( 1e-3, wocSplatR ) );
          float wocTop = max( max( wocE.x, wocE.y ), max( wocE.z, wocE.w ) );
          vec4 wocB = max( wocE - ( wocTop - 0.24 ), 0.0 );
          float wocBSum = wocB.x + wocB.y + wocB.z + wocB.w;
          vec4 wocHW = wocBSum > 1e-5 ? wocB / wocBSum : wocSplatR;

          // 100% Biome-Color-Neutral Vertex Color De-Smearing:
          // Instead of hardcoded dirt/rock colors (which would override biome palettes or erase
          // dry meadow patches), step diffuseColor.rgb along the triangle's own screen-space
          // color derivative d(diffuseColor)/d(nonGrassSplat) by the height-blended shift.
          float wocNonGrass0 = 1.0 - vWocSplat.x;
          float wocNonGrassR = 1.0 - wocHW.x;
          float wocDeltaS = wocNonGrassR - wocNonGrass0;
          vec2 wocGradS = vec2( dFdx( wocNonGrass0 ), dFdy( wocNonGrass0 ) );
          float wocGradS2 = dot( wocGradS, wocGradS );
          vec3 wocDColDS = (
            dFdx( diffuseColor.rgb ) * wocGradS.x +
            dFdy( diffuseColor.rgb ) * wocGradS.y
          ) / max( wocGradS2, 1e-5 );
          float wocEdgeGate = smoothstep( 1e-6, 1.2e-4, wocGradS2 );
          vec3 wocLayerVCol = clamp(
            diffuseColor.rgb + clamp( wocDColDS, vec3( -0.40 ), vec3( 0.40 ) ) * wocDeltaS * wocEdgeGate,
            vec3( 0.01 ),
            vec3( 1.0 )
          );

          // Extra channels from sampleVertex: vWocExtra = [mud, snow, scorch, ash]
          float wocMud = clamp( vWocExtra.x, 0.0, 1.0 );
          float wocSnow = clamp( vWocExtra.y, 0.0, 1.0 );
          float wocScorch = clamp( vWocExtra.z, 0.0, 1.0 );
          float wocAsh = clamp( vWocExtra.w, 0.0, 1.0 );

          // Zero-mean per-layer signals + odd cubic Hermite cel step s * (1.5 - 0.5 * s^2).
          // Dry dirt folds in fine rock grit (gravelW) while marsh mud softens into damp waves.
          float wocGravel = wocPatFine.b * 0.24 * ( 1.0 - wocMud );
          float wocDirtRaw = mix(
            wocPatMix.g * 0.80 + wocPatMacro.g * 0.42 + wocGravel,
            wocDirtWall,
            wocDirtWallW
          );
          float wocMudRaw = wocPatMacro.g * 0.65 + wocPatMix.a * 0.45 + wocPatMid.g * 0.25;
          float wocGSig = clamp( ( wocPatMix.r * 0.84 + wocPatMacro.r * 0.48 ) * 2.25, -1.0, 1.0 );
          float wocDSig = clamp( mix( wocDirtRaw, wocMudRaw, wocMud * 0.65 ) * 2.25, -1.0, 1.0 );
          float wocRSig = clamp( mix( wocPatMix.b * 0.86 + wocPatMacro.b * 0.44, wocRockWall, wocWallW ) * 2.35, -1.0, 1.0 );
          float wocSSig = clamp( ( wocPatMix.a * 0.80 + wocPatMacro.a * 0.42 + wocPatMix.g * 0.18 ) * 2.00, -1.0, 1.0 );

          float wocGCel = wocGSig * ( 1.5 - 0.5 * wocGSig * wocGSig );
          float wocDCel = wocDSig * ( 1.5 - 0.5 * wocDSig * wocDSig );
          float wocRCel = wocRSig * ( 1.5 - 0.5 * wocRSig * wocRSig );
          float wocSCel = wocSSig * ( 1.5 - 0.5 * wocSSig * wocSSig );

          // Strictly achromatic (hue-neutral) base gains so 100% of every biome's palette hue
          // (BIOME_PALETTE, TERRAIN_TONES, and Studio biomePaint) passes through unskewed.
          vec3 wocGBase = vec3( 0.43 );
          vec3 wocDBase = vec3( mix( 0.45, 0.38, wocMud ) );
          vec3 wocRBase = vec3( 0.46 );
          vec3 wocSBase = vec3( 0.45 );

          // Subtle zero-mean warm/cool meadow and stone drift (mirrors buildSplatMaterial hue3 / rockDrift)
          vec3 wocGrassHueDrift = mix(
            vec3( 1.04, 1.01, 0.95 ),
            vec3( 0.96, 0.99, 1.05 ),
            clamp( wocPatMacro.a + 0.5, 0.0, 1.0 )
          );
          vec3 wocRockHueDrift = mix(
            vec3( 0.96, 0.98, 1.03 ),
            vec3( 1.04, 1.00, 0.95 ),
            clamp( wocPatMacro.r + 0.5, 0.0, 1.0 )
          );

          vec3 wocGMod = wocGBase * wocGrassHueDrift * ( vec3( 1.0 ) + vec3( 0.32, 0.30, 0.24 ) * wocGCel );
          // Cross-path compacted core and kicked-up gravelly margin wear (mirrors buildSplatMaterial)
          float wocPathCore = smoothstep( 0.55, 0.90, vWocSplat.y + wocPatMix.g * 0.25 ) * ( 1.0 - wocMud );
          float wocPathEdge = wocHW.y * ( 1.0 - wocPathCore ) * ( 1.0 - wocMud );
          float wocPathWear = 1.0 + wocPathCore * 0.07 - wocPathEdge * 0.05;
          vec3 wocDMod = wocDBase * wocPathWear * ( vec3( 1.0 ) + vec3( 0.34, 0.32, 0.28 ) * wocDCel );
          vec3 wocRMod = wocRBase * wocRockHueDrift * ( vec3( 1.0 ) + vec3( 0.38, 0.37, 0.35 ) * wocRCel );
          vec3 wocSMod = wocSBase * ( vec3( 1.0 ) + vec3( 0.26, 0.24, 0.20 ) * wocSCel );

          vec3 wocCelTint = wocGMod * wocHW.x
                          + wocDMod * wocHW.y
                          + wocRMod * wocHW.z
                          + wocSMod * wocHW.w;

          // Snow blanket + sin-free cellular snow glint (mirrors buildSplatMaterial snow & sparkCell)
          if ( wocSnow > 0.005 ) {
            float wocSnowSig = clamp( ( wocPatMix.a * 0.72 + wocPatMacro.r * 0.48 ) * 1.85, -1.0, 1.0 );
            float wocSnowCel = wocSnowSig * ( 1.5 - 0.5 * wocSnowSig * wocSnowSig );
            vec3 wocSnowMod = vec3( 0.47 ) * mix(
              vec3( 0.88, 0.94, 1.04 ),
              vec3( 1.06, 1.05, 1.02 ),
              wocSnowCel * 0.5 + 0.5
            );
            float wocCamDist = length( cameraPosition - vWocWPos );
            vec3 wocSparkP = fract( vec3( floor( vWocWPos.xz * 12.0 ).xyx ) * 0.1031 );
            wocSparkP += dot( wocSparkP, wocSparkP.yzx + 33.33 );
            float wocSparkCell = fract( ( wocSparkP.x + wocSparkP.y ) * wocSparkP.z );
            float wocSnowSpark = step( 0.94, wocSparkCell )
              * smoothstep( 0.45, 0.85, wocSnow )
              * ( 1.0 - smoothstep( 18.0, 52.0, wocCamDist ) );
            wocSnowMod += vec3( 0.16, 0.17, 0.20 ) * wocSnowSpark;
            wocCelTint = mix( wocCelTint, wocSnowMod, wocSnow );
          }

          // Cavity & soft-kneed macro relief + cliff plate cavity + turf-lip border shadow + wet shoreline
          float wocUpW = smoothstep( 0.55, 0.86, wocAbsN.y ) * ( 1.0 - wocSnow * 0.75 );
          float wocCavH = dot( wocH4, wocHW * vec4( 0.35, 0.80, 1.0, 0.75 ) );
          float wocMacroRelief = ( wocPatMacro.r * wocHW.x + wocPatMacro.g * ( 1.0 - wocHW.x ) ) * 0.95;
          wocMacroRelief /= 1.0 + abs( wocMacroRelief ) * 1.4;
          float wocPlanarShade = mix( 1.0, clamp( 1.0 + wocCavH * 0.42 + wocMacroRelief * 0.28, 0.68, 1.24 ), wocUpW );
          float wocCliffShade = mix(
            1.0,
            clamp( 1.0 + wocWallCav * 0.65, 0.66, 1.18 ),
            wocHW.z * wocWallW * ( 1.0 - wocSnow )
          );
          float wocRoadLip = wocHW.y * ( 1.0 - wocHW.y ) * 4.0
            * smoothstep( 0.08, 0.42, vWocSplat.x )
            * clamp( 0.65 + wocCavH * 1.8, 0.25, 1.15 );
          float wocShoreWet = ( 1.0 - smoothstep( ${wetLow}, ${wetHigh}, vWocWPos.y ) ) * ( 1.0 - wocSnow );
          float wocWetW = wocShoreWet * clamp( wocHW.w + wocHW.y * 0.85, 0.0, 1.0 );
          float wocGroundShade = wocPlanarShade * wocCliffShade
            * ( 1.0 - wocRoadLip * 0.20 )
            * ( 1.0 - wocWetW * 0.22 );

          vec3 wocFinalRgb = wocLayerVCol * wocCelTint * wocGroundShade;

          // Meteor impact crater scorch and ash (mirrors buildSplatMaterial impactAlb)
          float wocImpactW = clamp( wocScorch * 0.86 + wocAsh * 0.18, 0.0, 0.96 );
          if ( wocImpactW > 0.005 ) {
            vec3 wocImpactCol = mix( vec3( 0.20, 0.08, 0.035 ), vec3( 0.055, 0.040, 0.032 ), wocAsh );
            vec3 wocImpactMod = wocImpactCol * ( 0.44 + 0.16 * wocRCel ) * wocGroundShade;
            wocFinalRgb = mix( wocFinalRgb, wocImpactMod, wocImpactW );
          }

          diffuseColor.rgb = wocFinalRgb;
        }
        #endif`;
}
