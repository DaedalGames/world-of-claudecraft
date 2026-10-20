import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the editor viewport's far-vista boot (viewport.ts is
// not Node-runnable end to end). Under polite pacing the far vista stood tens
// of seconds AFTER the editor revealed the scene, and until then outdoor fog
// clamped to the nearest unbuilt chunk: the whole scene sat in pale haze and
// then visibly cleared, the "colours change by themselves" report. The fix is
// the game's own curtain pattern, so these two lines are what regress it.
const viewport = readFileSync(
  path.join(__dirname, '..', 'src', 'editor', '3d', 'viewport.ts'),
  'utf8',
);
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('editor viewport far vista', () => {
  const start = stripComments(viewport.slice(viewport.indexOf('async start(): Promise<void>')));
  const body = start.slice(0, start.indexOf('\n  get ready(): boolean'));

  it('builds the far vista eagerly behind its build overlay', () => {
    const create = body.slice(body.indexOf('this.renderer = new Renderer('));
    const options = create.slice(0, create.indexOf('});'));
    expect(options).toContain('eagerFarVista: true');
  });

  it('waits for the far vista before the first visible frame', () => {
    const ready = body.indexOf('await this.renderer.farVistaReady()');
    expect(ready).toBeGreaterThan(body.indexOf('await this.renderer.prepareZoneAt('));
    expect(ready).toBeLessThan(body.indexOf('this.attachEvents()'));
    expect(ready).toBeLessThan(body.indexOf('this.loop()'));
  });
});

describe('editor viewport terrain paint path', () => {
  const code = stripComments(viewport);
  it('compiles the paint path for its terrain before building the renderer', () => {
    const start = code.slice(code.indexOf('async start(): Promise<void>'));
    const flag = start.indexOf('setPaintPathAlways(true)');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(start.indexOf('this.renderer = new Renderer('));
  });

  it('clears the switch when the viewport is disposed', () => {
    const dispose = code.slice(code.indexOf('  dispose(): void {'));
    expect(dispose.slice(0, dispose.indexOf('\n  }\n'))).toContain('setPaintPathAlways(false)');
  });
});
