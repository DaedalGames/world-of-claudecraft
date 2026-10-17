// The 3D viewport's half of moving built-in gameplay objects
// (sim/moved_objects.ts): picking a farm bed, practice dummy, gather node or
// dungeon door under the cursor, moving its live representation while the
// maker drags it, taking a deleted one out of the live scene (and putting a
// restored one back), and the selection ring. The decisions (the roster, the
// record edit, the nearest-object pick) live in ../object_moves_core.ts; this
// module only touches the live Sim entities and the renderer's preview hook,
// so the viewport keeps thin delegates.

import * as THREE from 'three';
import { farmCompostBinPosition } from '../../render/farm_patches_core';
import type { Renderer } from '../../render/renderer';
import { FARM_PATCHES } from '../../sim/content/farm_patches';
import { activeGatherNodes } from '../../sim/data';
import { farmPatchesFor, type ObjectMoves } from '../../sim/moved_objects';
import type { Sim } from '../../sim/sim';
import type { Entity } from '../../sim/types';
import { terrainHeight } from '../../sim/world';
import {
  type MovableObject,
  movableObjectByKey,
  nearestMovableObject,
  objectPosition,
  practiceDummyKeyForTemplate,
} from '../object_moves_core';

/** The loose pass, after placements miss (the NPC loose pass's reach). */
const LOOSE_PICK_PX = 44;

export interface MovableObjectsViewHost {
  renderer(): Renderer | null;
  sim(): Sim | null;
  seed(): number;
  canvas(): HTMLCanvasElement;
  moves(): ObjectMoves | undefined;
  /** False on a map that cannot move built-in objects (a linked map). */
  enabled(): boolean;
}

export class MovableObjectsView {
  private selectedKey: string | null = null;
  /** Dummy entities a delete took out of the live Sim, put back on restore. */
  private readonly removedDummies = new Map<string, Entity[]>();
  /** Where a patch's compost bin stood when its last bed was deleted (the
   *  hidden instance still sits there), so a restore can move it on. */
  private readonly hiddenBins = new Map<string, { x: number; z: number }>();
  private ring: THREE.Mesh | null = null;
  private readonly ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc04d,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  constructor(private readonly host: MovableObjectsViewHost) {}

  /** The movable object under the cursor, as its `<kind>:<id>` key. The
   *  exact passes first: the entity pick (a dummy, a door) and the gather-node
   *  raycast, both occlusion-correct, so they may beat a placement's slack
   *  radius. `directOnly` stops there; otherwise the loose projected pass runs
   *  too (the only way to a bed, which is no entity), which the viewport asks
   *  only after placements miss. */
  pick(clientX: number, clientY: number, directOnly: boolean): string | null {
    const renderer = this.host.renderer();
    const sim = this.host.sim();
    if (!renderer || !sim || !this.host.enabled()) return null;
    const rect = this.host.canvas().getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const id = renderer.picking.pickDirect(localX, localY);
    const entity = id === null ? undefined : sim.entities.get(id);
    if (entity?.kind === 'mob' && entity.ownerId === null) {
      const key = practiceDummyKeyForTemplate(entity.templateId);
      if (key) return key;
    }
    if (entity?.templateId === 'dungeon_door' && entity.dungeonId) {
      const key = `dungeonDoor:${entity.dungeonId}`;
      if (movableObjectByKey(key)) return key;
    }
    const nodeId = renderer.picking.pickGatherNode(localX, localY);
    if (nodeId !== null) {
      const key = `gatherNode:${nodeId}`;
      if (movableObjectByKey(key)) return key;
    }
    if (directOnly) return null;
    return this.nearest(clientX, clientY, LOOSE_PICK_PX, (o) => this.drawn(o))?.key ?? null;
  }

  /** Move the object's live representation from where `before` stood it to
   *  where `after` does: the Sim entity for a dummy or a door, the renderer's
   *  drawn instance for a bed (and its patch's compost bin), a node, or a
   *  door's entrance set piece. Colliders are the caller's (one rebuild per
   *  gesture, not per sample). True when the live scene cannot show the
   *  change (a restore of something this build never drew): the caller
   *  rebuilds the world from the document. */
  moveLive(key: string, before: ObjectMoves | undefined, after: ObjectMoves | undefined): boolean {
    const object = movableObjectByKey(key);
    const sim = this.host.sim();
    const renderer = this.host.renderer();
    if (!object) return false;
    const wasRemoved = before?.[key]?.removed === true;
    const isRemoved = after?.[key]?.removed === true;
    if (wasRemoved !== isRemoved) {
      const shown = this.setLiveRemoved(object, isRemoved, before, after);
      this.syncRing();
      return !shown;
    }
    const from = objectPosition(before, object);
    const to = objectPosition(after, object);
    if (from.x === to.x && from.z === to.z) return false;
    const seed = this.host.seed();
    const ground = { x: to.x, y: terrainHeight(to.x, to.z, seed), z: to.z };
    if (object.kind === 'practiceDummy' && sim) {
      for (const entity of sim.entities.values()) {
        if (entity.kind !== 'mob' || entity.ownerId !== null) continue;
        if (entity.templateId !== object.id) continue;
        Object.assign(entity.pos, ground);
        Object.assign(entity.prevPos, ground);
        Object.assign(entity.spawnPos, ground);
        if (entity.leashAnchor) Object.assign(entity.leashAnchor, ground);
      }
    } else if (object.kind === 'dungeonDoor') {
      if (sim) {
        for (const entity of sim.entities.values()) {
          if (entity.templateId !== 'dungeon_door' || entity.dungeonId !== object.id) continue;
          Object.assign(entity.pos, ground);
          Object.assign(entity.prevPos, ground);
        }
      }
      renderer?.editor.previewObjectMove({ kind: 'dungeonDoor', dungeonId: object.id }, from, to);
    } else if (object.kind === 'gatherNode') {
      renderer?.editor.previewObjectMove({ kind: 'gatherNode', id: object.id }, from, to);
    } else if (object.kind === 'farmBed' && object.patchId !== undefined && renderer) {
      renderer.editor.previewObjectMove(
        {
          kind: 'farmBed',
          patchId: object.patchId,
          bedIndex: object.bedIndex ?? 0,
          bedId: object.id,
        },
        from,
        to,
      );
      const binFrom = this.binOf(before, object.patchId);
      const binTo = this.binOf(after, object.patchId);
      if (binFrom && binTo) {
        renderer.editor.previewObjectMove(
          { kind: 'farmBin', patchId: object.patchId },
          binFrom,
          binTo,
        );
      }
    }
    this.syncRing();
    return false;
  }

  /** Forget the live delete state: the engine was rebuilt from the document,
   *  which already leaves deleted objects out. */
  resetLive(): void {
    this.removedDummies.clear();
    this.hiddenBins.clear();
  }

  /** Take a deleted object out of the live scene, or put a restored one
   *  back: the Sim entity for a dummy (kept and re-added, so a restore is the
   *  same dummy), the drawn instance for a node, a bed and, once a patch has
   *  no beds left, its compost bin. False when a restore found nothing to
   *  bring back (this build never drew it, or never had the dummy). */
  private setLiveRemoved(
    object: MovableObject,
    removed: boolean,
    before: ObjectMoves | undefined,
    after: ObjectMoves | undefined,
  ): boolean {
    const sim = this.host.sim();
    const renderer = this.host.renderer();
    if (object.kind === 'practiceDummy') {
      if (!sim) return true;
      if (removed) {
        const taken: Entity[] = [];
        for (const entity of [...sim.entities.values()]) {
          if (entity.kind !== 'mob' || entity.ownerId !== null) continue;
          if (entity.templateId !== object.id) continue;
          taken.push(entity);
          sim.removeEntity(entity.id);
        }
        this.removedDummies.set(object.key, taken);
        return true;
      }
      const at = objectPosition(after, object);
      const ground = { x: at.x, y: terrainHeight(at.x, at.z, this.host.seed()), z: at.z };
      const back = this.removedDummies.get(object.key) ?? [];
      this.removedDummies.delete(object.key);
      // Deleted when the map loaded: only the spawner stands one up right
      // (its reserved id, facing and resting health), so the world rebuilds.
      if (back.length === 0) return false;
      for (const entity of back) {
        Object.assign(entity.pos, ground);
        Object.assign(entity.prevPos, ground);
        Object.assign(entity.spawnPos, ground);
        if (entity.leashAnchor) Object.assign(entity.leashAnchor, ground);
        sim.addEntity(entity);
      }
      return true;
    }
    if (!renderer) return true;
    if (object.kind === 'gatherNode') {
      const changed = renderer.editor.setObjectHidden(
        { kind: 'gatherNode', id: object.id },
        removed,
      );
      return removed || changed > 0;
    }
    if (object.kind !== 'farmBed' || object.patchId === undefined) return true;
    const patchId = object.patchId;
    const changed = renderer.editor.setObjectHidden(
      { kind: 'farmBed', patchId, bedIndex: object.bedIndex ?? 0, bedId: object.id },
      removed,
    );
    if (!removed && changed === 0) return false;
    // The bin sits beside the patch's remaining beds: it follows them, hides
    // with the last one and comes back with the first one restored.
    const binFrom = this.binOf(before, patchId) ?? this.hiddenBins.get(patchId) ?? null;
    const binTo = this.binOf(after, patchId);
    if (binFrom && !binTo) {
      renderer.editor.setObjectHidden({ kind: 'farmBin', patchId }, true);
      this.hiddenBins.set(patchId, binFrom);
      return true;
    }
    if (this.hiddenBins.has(patchId) && binTo) {
      renderer.editor.setObjectHidden({ kind: 'farmBin', patchId }, false);
      this.hiddenBins.delete(patchId);
    }
    if (binFrom && binTo) {
      renderer.editor.previewObjectMove({ kind: 'farmBin', patchId }, binFrom, binTo);
    }
    return true;
  }

  /** Ring the selected object (or clear it with null). */
  setSelected(key: string | null): void {
    this.selectedKey = key && movableObjectByKey(key) ? key : null;
    this.syncRing();
  }

  /** Re-seat the ring on the selected object's current spot. */
  syncRing(): void {
    const renderer = this.host.renderer();
    const object = this.selectedKey ? movableObjectByKey(this.selectedKey) : undefined;
    if (!renderer || !object) {
      if (this.ring) this.ring.visible = false;
      return;
    }
    if (!this.ring || this.ring.parent !== renderer.scene) {
      this.disposeRing();
      const geometry = new THREE.RingGeometry(1.4, 1.75, 40);
      geometry.rotateX(-Math.PI / 2);
      this.ring = new THREE.Mesh(geometry, this.ringMat);
      this.ring.name = 'editor-object-selection';
      this.ring.renderOrder = 3;
      renderer.scene.add(this.ring);
    }
    const pos = objectPosition(this.host.moves(), object);
    this.ring.position.set(pos.x, terrainHeight(pos.x, pos.z, this.host.seed()) + 0.14, pos.z);
    this.ring.visible = true;
  }

  dispose(): void {
    this.disposeRing();
    this.ringMat.dispose();
  }

  private disposeRing(): void {
    if (!this.ring) return;
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ring = null;
  }

  /** Whether the viewport actually draws this object, so the loose pass never
   *  picks something invisible (a node on a map that hides the veins, a dummy
   *  on a map without the practice yard). */
  private drawn(object: MovableObject): boolean {
    if (object.kind === 'gatherNode') return activeGatherNodes().length > 0;
    if (object.kind === 'practiceDummy') {
      const sim = this.host.sim();
      if (!sim) return false;
      for (const entity of sim.entities.values()) {
        if (entity.kind === 'mob' && entity.templateId === object.id) return true;
      }
      return false;
    }
    return true;
  }

  private binOf(moves: ObjectMoves | undefined, patchId: string): { x: number; z: number } | null {
    const patch = farmPatchesFor(moves, FARM_PATCHES).find((p) => p.id === patchId);
    return patch ? farmCompostBinPosition(patch) : null;
  }

  private nearest(
    clientX: number,
    clientY: number,
    maxPx: number,
    include: (object: MovableObject) => boolean,
  ): MovableObject | null {
    const renderer = this.host.renderer();
    if (!renderer) return null;
    const rect = this.host.canvas().getBoundingClientRect();
    const seed = this.host.seed();
    const v = new THREE.Vector3();
    return nearestMovableObject(
      this.host.moves(),
      (x, z) => {
        v.set(x, terrainHeight(x, z, seed) + 0.5, z).project(renderer.camera);
        if (v.z < -1 || v.z > 1) return null;
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      },
      clientX,
      clientY,
      maxPx,
      include,
    );
  }
}
