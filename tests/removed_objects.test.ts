// @vitest-environment happy-dom
// Deleting built-in gameplay objects from a Studio map (src/sim/moved_objects.ts
// `removed`): a farm bed, practice dummy or gather node a map deletes drops
// out of every table and spawner while keeping its ids and the ids around it,
// a dungeon door can never be deleted, and the editor's record edit,
// controller undo, panels and live scene preview carry the delete and the
// restore (src/editor/object_moves_core.ts, object_move_controller.ts,
// object_move_panel.ts, src/render/editor_api/moved_object_preview.ts).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MovableObjectsView } from '../src/editor/3d/movable_objects_view';
import {
  ObjectMoveController,
  type ObjectMoveUndoEntry,
} from '../src/editor/object_move_controller';
import { buildObjectMovePanel, buildRemovedObjectsPanel } from '../src/editor/object_move_panel';
import {
  movableObjectByKey,
  nearestMovableObject,
  objectIsMoved,
  objectIsRemoved,
  objectPosition,
  removedObjects,
  withObjectMovedTo,
  withObjectRemoved,
} from '../src/editor/object_moves_core';
import { setMovedObjectHidden } from '../src/render/editor_api/moved_object_preview';
import type { Renderer } from '../src/render/renderer';
import { FARM_PATCHES, farmBedById } from '../src/sim/content/farm_patches';
import { HEALING_TRAINING_GROUND_SPAWNS } from '../src/sim/content/healing_training';
import { HUB_TRAINING_DUMMY_ID } from '../src/sim/content/practice_dummies';
import {
  BUILTIN_WORLD,
  DUNGEON_LIST,
  GATHER_NODES,
  gatherNodesInActiveWorld,
  setActiveWorldContent,
} from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import {
  farmBedFor,
  farmPatchesFor,
  freezeObjectMoves,
  gatherNodesFor,
  type ObjectMove,
  type ObjectMoves,
  objectMoveKey,
  practiceDummyRemoved,
  sanitizeObjectMoves,
} from '../src/sim/moved_objects';
import { gatherNodeById } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { hubLessonCenter } from '../src/ui/hud/practice/hub_lesson_controller';

const PATCH = FARM_PATCHES[0];
const BED = PATCH.beds[0];
const BED_KEY = objectMoveKey('farmBed', BED.id);
const NODE = GATHER_NODES[0];
const NODE_KEY = objectMoveKey('gatherNode', NODE.id);
const DOOR = DUNGEON_LIST.find((d) => d.overworldDoor !== false);
if (!DOOR) throw new Error('no overworld door');
const DOOR_KEY = objectMoveKey('dungeonDoor', DOOR.id);
const DUMMY_KEY = objectMoveKey('practiceDummy', HUB_TRAINING_DUMMY_ID);

const removedAt = (x: number, z: number): ObjectMove => ({ x, z, removed: true });

afterEach(() => setActiveWorldContent(null));

describe('removed objects: the shared record', () => {
  it('keeps a removal for beds, dummies and nodes, and reads one on a door as a move', () => {
    const clean = sanitizeObjectMoves(
      {
        [BED_KEY]: { x: BED.x, z: BED.z, removed: true },
        [NODE_KEY]: { x: 1, z: 2, removed: true },
        [DUMMY_KEY]: { x: 3, z: 4, removed: true },
        [DOOR_KEY]: { x: 5, z: 6, removed: true },
        [objectMoveKey('gatherNode', 'other')]: { x: 7, z: 8, removed: 'yes' },
      },
      5000,
    );
    expect(clean?.[BED_KEY]).toEqual({ x: BED.x, z: BED.z, removed: true });
    expect(clean?.[NODE_KEY]?.removed).toBe(true);
    expect(clean?.[DUMMY_KEY]?.removed).toBe(true);
    expect(clean?.[DOOR_KEY]).toEqual({ x: 5, z: 6 });
    expect(clean?.[objectMoveKey('gatherNode', 'other')]).toEqual({ x: 7, z: 8 });
    // freezing keeps the flag too
    expect(freezeObjectMoves({ [BED_KEY]: removedAt(1, 2) })?.[BED_KEY]).toEqual(removedAt(1, 2));
  });

  it('survives the map document sanitizer the server also applies', () => {
    const doc = sanitizeMapDoc({
      content: { zones: BUILTIN_WORLD.zones },
      objectMoves: { [BED_KEY]: removedAt(BED.x, BED.z) },
    });
    expect(doc?.objectMoves?.[BED_KEY]).toEqual(removedAt(BED.x, BED.z));
  });
});

describe('removed objects: the game reads', () => {
  it('drops a removed bed from its patch, and a patch whose beds are all gone', () => {
    const one = freezeObjectMoves({ [BED_KEY]: removedAt(BED.x, BED.z) });
    const patch = farmPatchesFor(one, FARM_PATCHES).find((p) => p.id === PATCH.id);
    expect(patch?.beds.map((b) => b.id)).toEqual(PATCH.beds.slice(1).map((b) => b.id));
    expect(farmBedFor(one, farmBedById(BED.id))).toBeUndefined();
    const all = freezeObjectMoves(
      Object.fromEntries(
        PATCH.beds.map((b) => [objectMoveKey('farmBed', b.id), removedAt(b.x, b.z)]),
      ),
    );
    const patches = farmPatchesFor(all, FARM_PATCHES);
    expect(patches.some((p) => p.id === PATCH.id)).toBe(false);
    expect(patches).toHaveLength(FARM_PATCHES.length - 1);
  });

  it('drops a removed gather node from the table and the by-id lookup', () => {
    const moves = freezeObjectMoves({ [NODE_KEY]: removedAt(NODE.pos.x, NODE.pos.z) });
    const nodes = gatherNodesFor(moves, GATHER_NODES);
    expect(nodes).toHaveLength(GATHER_NODES.length - 1);
    expect(nodes.some((n) => n.id === NODE.id)).toBe(false);
    expect(gatherNodeById(NODE.id, moves)).toBeUndefined();
    setActiveWorldContent({ ...BUILTIN_WORLD, objectMoves: moves });
    expect(gatherNodesInActiveWorld().some((n) => n.id === NODE.id)).toBe(false);
  });

  it('skips a removed dummy at spawn while every other entity keeps its id', () => {
    const healingRow = HEALING_TRAINING_GROUND_SPAWNS[0];
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      objectMoves: freezeObjectMoves({
        [DUMMY_KEY]: removedAt(0, 0),
        [objectMoveKey('practiceDummy', healingRow.mobId)]: removedAt(0, 0),
      }),
    };
    expect(practiceDummyRemoved(world.objectMoves, HUB_TRAINING_DUMMY_ID)).toBe(true);
    const rows = (sim: Sim) =>
      [...sim.entities.values()]
        .map((e) => [e.id, e.templateId, e.level, e.pos.x, e.pos.z] as const)
        .sort((a, b) => a[0] - b[0]);
    const shipped = rows(new Sim({ seed: 5, playerClass: 'priest', world: { ...BUILTIN_WORLD } }));
    const removed = rows(new Sim({ seed: 5, playerClass: 'priest', world }));
    const gone = new Set([HUB_TRAINING_DUMMY_ID, healingRow.mobId]);
    expect(removed.some(([, t]) => gone.has(t))).toBe(false);
    expect(removed).toEqual(shipped.filter(([, t]) => !gone.has(t)));
  });
});

describe('removed objects: the editor record edit', () => {
  it('deletes at the current spot, restores there, and drops the entry back home', () => {
    const bed = movableObjectByKey(BED_KEY);
    if (!bed) throw new Error('no bed');
    const moved = withObjectMovedTo(undefined, BED_KEY, { x: BED.x + 4, z: BED.z });
    const removed = withObjectRemoved(moved, BED_KEY, true);
    expect(removed?.[BED_KEY]).toEqual({ x: BED.x + 4, z: BED.z, removed: true });
    expect(objectIsRemoved(removed, BED_KEY)).toBe(true);
    expect(objectIsMoved(removed, BED_KEY)).toBe(false);
    expect(removedObjects(removed).map((o) => o.key)).toEqual([BED_KEY]);
    // a deleted object is never moved, and never picked
    expect(withObjectMovedTo(removed, BED_KEY, { x: 0, z: 0 })).toBe(removed);
    expect(
      nearestMovableObject(
        removed,
        () => ({ x: 0, y: 0 }),
        0,
        0,
        10,
        (o) => o.key === BED_KEY,
      ),
    ).toBeNull();
    const restored = withObjectRemoved(removed, BED_KEY, false);
    expect(restored?.[BED_KEY]).toEqual({ x: BED.x + 4, z: BED.z });
    expect(
      withObjectRemoved(withObjectRemoved(undefined, BED_KEY, true), BED_KEY, false),
    ).toBeUndefined();
    expect(objectPosition(restored, bed)).toEqual({ x: BED.x + 4, z: BED.z });
  });

  it('never deletes a dungeon door', () => {
    expect(withObjectRemoved(undefined, DOOR_KEY, true)).toBeUndefined();
  });
});

describe('removed objects: the controller and panels', () => {
  function harness() {
    let moves: ObjectMoves | undefined;
    const undo: ObjectMoveUndoEntry[] = [];
    const live: [string, boolean, boolean][] = [];
    const controller = new ObjectMoveController({
      getMoves: () => moves,
      setMoves: (next) => {
        moves = next;
      },
      moveLive: (key, before, after) =>
        live.push([key, before?.[key]?.removed === true, after?.[key]?.removed === true]),
      showSelection: () => {},
      pushUndo: (entry) => undo.push(entry),
      committed: () => {},
    });
    return { controller, undo, live, moves: () => moves };
  }

  it('deletes the selection as one undo step that restores it', () => {
    const h = harness();
    h.controller.select(BED_KEY);
    expect(h.controller.removeSelected()).toBe(true);
    expect(h.controller.selectedKey).toBeNull();
    expect(objectIsRemoved(h.moves(), BED_KEY)).toBe(true);
    expect(h.undo.map((u) => u.label)).toEqual(['remove-object']);
    expect(h.live.at(-1)).toEqual([BED_KEY, false, true]);
    h.undo[0].undo();
    expect(objectIsRemoved(h.moves(), BED_KEY)).toBe(false);
    expect(h.live.at(-1)).toEqual([BED_KEY, true, false]);
    h.undo[0].redo();
    expect(objectIsRemoved(h.moves(), BED_KEY)).toBe(true);
    h.controller.restore(BED_KEY);
    expect(h.moves()).toBeUndefined();
    expect(h.undo.map((u) => u.label)).toEqual(['remove-object', 'restore-object']);
  });

  it('refuses to delete a selected dungeon door', () => {
    const h = harness();
    h.controller.select(DOOR_KEY);
    expect(h.controller.removeSelected()).toBe(false);
    expect(h.undo).toHaveLength(0);
  });

  it('offers Delete for a bed, explains doors, and lists deleted objects with Restore', () => {
    const restored: string[] = [];
    const bedPanel = buildObjectMovePanel({
      selectedKey: () => BED_KEY,
      moves: () => undefined,
      reset: () => {},
      remove: () => {},
    });
    expect(bedPanel?.textContent).toContain('Delete from this map');
    const doorPanel = buildObjectMovePanel({
      selectedKey: () => DOOR_KEY,
      moves: () => undefined,
      reset: () => {},
      remove: () => {},
    });
    expect(doorPanel?.textContent).not.toContain('Delete from this map');
    expect(doorPanel?.textContent).toContain('could not be entered');
    expect(buildRemovedObjectsPanel({ moves: () => undefined, restore: () => {} })).toBeNull();
    const list = buildRemovedObjectsPanel({
      moves: () => freezeObjectMoves({ [BED_KEY]: removedAt(BED.x, BED.z) }),
      restore: (key) => restored.push(key),
    });
    expect(list?.textContent).toContain(`Farm bed: ${BED.id}`);
    list?.querySelector('button')?.click();
    expect(restored).toEqual([BED_KEY]);
  });
});

describe('removed objects: the live scene preview', () => {
  it('hides a bed instance by id and puts its exact matrix back on restore', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    mesh.name = `farmPatches:bed:${PATCH.id}`;
    // This build already left the patch's first bed out: index 0 is bed 2.
    mesh.userData.farmBedIds = [PATCH.beds[1].id, PATCH.beds[2].id];
    const m = new THREE.Matrix4().makeTranslation(3, 4, 5);
    mesh.setMatrixAt(1, m);
    scene.add(mesh);
    const target = {
      kind: 'farmBed' as const,
      patchId: PATCH.id,
      bedIndex: 2,
      bedId: PATCH.beds[2].id,
    };
    expect(setMovedObjectHidden(scene, target, true)).toBe(1);
    const read = new THREE.Matrix4();
    mesh.getMatrixAt(1, read);
    // collapsed to nothing, but at its own spot: the batch bounds stay put
    expect(read.elements.slice(0, 12).every((v) => v === 0)).toBe(true);
    expect(read.elements.slice(12)).toEqual([3, 4, 5, 1]);
    expect(setMovedObjectHidden(scene, target, true)).toBe(0);
    expect(setMovedObjectHidden(scene, target, false)).toBe(1);
    mesh.getMatrixAt(1, read);
    expect(read.equals(m)).toBe(true);
    mesh.geometry.dispose();
  });
});

describe('removed objects: the live view and the practice coach', () => {
  it('asks for a world rebuild when a restore finds nothing drawn to bring back', () => {
    const hidden: [string, boolean][] = [];
    const renderer = {
      scene: new THREE.Scene(),
      editor: {
        // This build never drew the bed (deleted when the map loaded).
        setObjectHidden: (target: { kind: string }, on: boolean) => {
          hidden.push([target.kind, on]);
          return 0;
        },
        previewObjectMove: () => 0,
      },
    } as unknown as Renderer;
    const view = new MovableObjectsView({
      renderer: () => renderer,
      sim: () => null,
      seed: () => 1,
      canvas: () => document.createElement('canvas'),
      moves: () => undefined,
      enabled: () => true,
    });
    const removed = freezeObjectMoves({ [BED_KEY]: removedAt(BED.x, BED.z) });
    expect(view.moveLive(BED_KEY, undefined, removed)).toBe(false);
    expect(view.moveLive(BED_KEY, removed, undefined)).toBe(true);
    expect(hidden[0]).toEqual(['farmBed', true]);
  });

  it('stays quiet on a map that deleted a yard dummy', () => {
    expect(hubLessonCenter()).not.toBeNull();
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      objectMoves: freezeObjectMoves({ [DUMMY_KEY]: removedAt(0, 0) }),
    });
    expect(hubLessonCenter()).toBeNull();
  });
});
