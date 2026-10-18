// Picking batched placements (render/placed_batches.ts). three's InstancedMesh
// raycast culls against a bounding sphere it computes ONCE on the first
// raycast and never refreshes, so a batch that gained, moved or regrew its
// instances after that first click kept testing the old sphere: every copy
// outside it (a tree streamed in later, a rock dragged elsewhere) became
// unclickable in the Studio, whose exact-hit picking has no loose fallback.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type BatchSub, PlacedBatches } from '../src/render/placed_batches';

const PATH = 'models/test_tree.glb';

/** A unit box template: one sub-mesh, no node transform. */
const boxSubs = (): BatchSub[] => [
  {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicMaterial(),
    local: new THREE.Matrix4(),
    sources: [0],
    sourceLocals: [new THREE.Matrix4()],
  },
];

const at = (x: number, z = 0): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, 0, z);

/** The placement id under a straight-down ray at (x, z), or null. */
function pickAt(batches: PlacedBatches, x: number, z = 0): number | null {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  for (const hit of raycaster.intersectObject(batches.group, true)) {
    if (hit.instanceId === undefined) continue;
    const id = batches.idAt(hit.object, hit.instanceId);
    if (id !== null) return id;
  }
  return null;
}

describe('PlacedBatches raycast bounds', () => {
  it('picks an instance attached after an earlier raycast', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    expect(pickAt(batches, 0)).toBe(1); // first raycast computes the sphere
    batches.attach(2, PATH, subs, at(100));
    expect(pickAt(batches, 100)).toBe(2);
  });

  it('picks an instance at its new spot after its matrix moved', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    batches.attach(2, PATH, subs, at(2));
    expect(pickAt(batches, 2)).toBe(2);
    batches.setMatrix(2, at(-150, 40));
    expect(pickAt(batches, -150, 40)).toBe(2);
    expect(pickAt(batches, 2)).toBeNull();
  });

  it('picks the copy swapped into a freed slot after a detach', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(1, PATH, subs, at(0));
    batches.attach(2, PATH, subs, at(3));
    expect(pickAt(batches, 0)).toBe(1);
    batches.detach(1);
    batches.attach(3, PATH, subs, at(80));
    expect(pickAt(batches, 0)).toBeNull();
    expect(pickAt(batches, 3)).toBe(2);
    expect(pickAt(batches, 80)).toBe(3);
  });

  it('picks every copy after the batch grew past its initial capacity', () => {
    const subs = boxSubs();
    const batches = new PlacedBatches();
    batches.attach(0, PATH, subs, at(0));
    expect(pickAt(batches, 0)).toBe(0);
    for (let id = 1; id < 20; id++) batches.attach(id, PATH, subs, at(id * 10));
    for (let id = 0; id < 20; id++) expect(pickAt(batches, id * 10)).toBe(id);
  });
});
