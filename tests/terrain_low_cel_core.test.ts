import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { terrainInternalsForTest } from '../src/render/terrain';
import {
  bakeLowCelGroundRgba,
  LOW_CEL_GROUND_PATCH_MARKER,
  LOW_CEL_GROUND_SIZE,
  lowCelLambertColorFragmentGlsl,
} from '../src/render/terrain_low_cel_core';
import { groundDetailTexture } from '../src/render/textures';

describe('low-tier stylized cel ground pattern (terrain_low_cel_core)', () => {
  const rgba = bakeLowCelGroundRgba(64);
  const pixelCount = 64 * 64;

  it('is deterministic byte-for-byte and validates power-of-two sizes', () => {
    const second = bakeLowCelGroundRgba(64);
    expect(Buffer.from(rgba).equals(Buffer.from(second))).toBe(true);
    expect(() => bakeLowCelGroundRgba(0)).toThrow(/power of two/);
    expect(() => bakeLowCelGroundRgba(30)).toThrow(/power of two/);
  });

  it('centers all four RGBA channels on 128 with strong cel contrast so distant mips never darken', () => {
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      let min = 255;
      let max = 0;
      for (let i = ch; i < rgba.length; i += 4) {
        const v = rgba[i];
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const mean = sum / pixelCount;
      let sq = 0;
      for (let i = ch; i < rgba.length; i += 4) {
        const d = rgba[i] - mean;
        sq += d * d;
      }
      const sd = Math.sqrt(sq / pixelCount);
      // Mean is pinned within 0.6 byte of 128 so the top mip averages to 0.0 after `- 128/255`.
      expect(Math.abs(mean - 128), `channel ${ch} mean ${mean}`).toBeLessThan(0.6);
      expect(sd, `channel ${ch} sd ${sd}`).toBeGreaterThan(36);
      expect(sd, `channel ${ch} sd ${sd}`).toBeLessThan(60);
      expect(min, `channel ${ch} min`).toBeLessThan(70);
      expect(max, `channel ${ch} max`).toBeGreaterThan(185);
    }
  });

  it('packs four distinct material patterns rather than duplicating one greyscale noise', () => {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        let diffSum = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          diffSum += Math.abs(rgba[i + a] - rgba[i + b]);
        }
        const meanAbsDiff = diffSum / pixelCount;
        expect(meanAbsDiff, `channels ${a} vs ${b} mean abs diff`).toBeGreaterThan(28);
      }
    }
  });

  it('tiles seamlessly across both X and Y wrap borders without a seam jump', () => {
    const s = 64;
    for (let ch = 0; ch < 4; ch++) {
      let wrapStepX = 0;
      let innerStepX = 0;
      let wrapStepY = 0;
      let innerStepY = 0;
      for (let i = 0; i < s; i++) {
        const left = rgba[(i * s + 0) * 4 + ch];
        const right = rgba[(i * s + (s - 1)) * 4 + ch];
        wrapStepX += Math.abs(left - right);

        const top = rgba[(0 * s + i) * 4 + ch];
        const bot = rgba[((s - 1) * s + i) * 4 + ch];
        wrapStepY += Math.abs(top - bot);

        for (let j = 0; j < s - 1; j++) {
          innerStepX += Math.abs(rgba[(i * s + j) * 4 + ch] - rgba[(i * s + j + 1) * 4 + ch]);
          innerStepY += Math.abs(rgba[(j * s + i) * 4 + ch] - rgba[((j + 1) * s + i) * 4 + ch]);
        }
      }
      const meanWrapX = wrapStepX / s;
      const meanInnerX = innerStepX / (s * (s - 1));
      const meanWrapY = wrapStepY / s;
      const meanInnerY = innerStepY / (s * (s - 1));
      expect(meanWrapX, `ch ${ch} X wrap ${meanWrapX} vs inner ${meanInnerX}`).toBeLessThan(
        meanInnerX * 1.45 + 6,
      );
      expect(meanWrapY, `ch ${ch} Y wrap ${meanWrapY} vs inner ${meanInnerY}`).toBeLessThan(
        meanInnerY * 1.45 + 6,
      );
    }
  });

  it('uploads groundDetailTexture as a 256x256 linear mipmapped RGBA DataTexture', () => {
    const tex = groundDetailTexture();
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    const img = tex.image as { width: number; height: number };
    expect(img.width).toBe(LOW_CEL_GROUND_SIZE);
    expect(img.height).toBe(LOW_CEL_GROUND_SIZE);
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(tex.generateMipmaps).toBe(true);
  });

  it('wires aSplat, aExtra, competitive height blending, and biome-neutral de-smearing into the Lambert shader', () => {
    const snippet = lowCelLambertColorFragmentGlsl(1.5);
    expect(snippet).toContain(LOW_CEL_GROUND_PATCH_MARKER);
    expect(snippet).toContain('smoothstep( 1.6, 3.1, vWocWPos.y )');

    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    terrainInternalsForTest
      .createLambertMaterial()
      .onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        null as unknown as THREE.WebGLRenderer,
      );

    expect(shader.vertexShader).toContain('attribute vec4 aSplat;');
    expect(shader.vertexShader).toContain('attribute vec4 aExtra;');
    expect(shader.vertexShader).toContain('varying vec4 vWocSplat;');
    expect(shader.vertexShader).toContain('varying vec4 vWocExtra;');
    expect(shader.vertexShader).toContain('varying vec3 vWocWNorm;');
    expect(shader.fragmentShader).toContain(LOW_CEL_GROUND_PATCH_MARKER);
    expect(shader.fragmentShader).toContain('wocHW');
    expect(shader.fragmentShader).toContain('wocDColDS');
    expect(shader.fragmentShader).toContain('wocSnow');
    expect(shader.fragmentShader).toContain('wocImpactW');
    expect(shader.fragmentShader).toContain('wocWallUv');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  });
});
