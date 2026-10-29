// The service-window family's slow-band refresh latch: the copper vendor,
// the heroic, crucible and WARFARE quartermasters, the training ladder and
// the unbind list. Every one of them is a full-subtree painter Hud repaints
// through repaintOpenServiceWindows, but before this latch only their own
// action events and the online inventory hook reached that repaint, so an
// open window priced against a snapshot: offline loot copper, honor gained
// online, a reputation step or a quest accept never re-priced it, and a train
// Learn lost to a disconnect stayed disabled past its TTL until something
// else moved.
//
// The signature digests exactly what those painters read off IWorld (the
// purse and the three balances, an inventory digest with the bound flags the
// unbind list and the sigil counts read, worn ids, buyback, standings and
// faction currencies, proficiency, the quest-log ids and states plus the done
// count the quest-gated rows read, the riding tier, the training identity and
// the in-flight Learn ids at `now`). It is built ONLY while some service
// window is shown, and one signature serves the whole family: a dimension a
// given window ignores costs at most one redundant rebuild of a painter that
// already carries focus across it.
//
// The latch never rebuilds under a live interaction: an open custom-amount
// buy prompt (it holds the vendor root inert) or a purchase / unbind confirm
// dialog skips the poll WITHOUT moving the latch, so the next poll after it
// closes catches up.

import type { IWorld } from '../../../world_api';

/** The IWorld reads the service painters render from. */
export type ServiceWindowWorld = Pick<
  IWorld,
  | 'copper'
  | 'honor'
  | 'heroicMarks'
  | 'inventory'
  | 'equipment'
  | 'vendorBuyback'
  | 'factions'
  | 'factionCurrencies'
  | 'gatheringProficiency'
  | 'questLog'
  | 'questsDone'
  | 'ridingTrainingTier'
  | 'craftingIdentity'
  | 'stationPlacements'
  | 'ownedBuddies'
  | 'pendingBuddies'
>;

/** The Hud's TrainLearnTracker, read for the in-flight / confirmed overlay. */
export interface ServiceTrainLearns {
  pendingIds(nowMs: number): ReadonlySet<string>;
  confirmedIds(mirrorKnown: readonly string[]): ReadonlySet<string>;
}

/** The service-window roots, each shown with `display: block`. The three
 *  shop tenants share `#vendor-window`. */
const SERVICE_ROOT_IDS = ['vendor-window', 'warfare-window', 'train-window', 'unbind-window'];

function record(r: Readonly<Record<string, number | undefined>>): string {
  return Object.keys(r)
    .sort()
    .map((k) => `${k}=${r[k]}`)
    .join(',');
}

function sorted(ids: Iterable<string>): string {
  return [...ids].sort().join(',');
}

/** The data signature of everything the service family renders. Pure. */
export function serviceWindowSig(
  world: ServiceWindowWorld,
  learns: ServiceTrainLearns,
  nowMs: number,
): string {
  const identity = world.craftingIdentity;
  const inv = world.inventory
    .map((s) => `${s.itemId}:${s.count}${s.instance?.boundTo !== undefined ? 'b' : ''}`)
    .join(',');
  const quests: string[] = [];
  for (const [id, q] of world.questLog) quests.push(`${id}:${q.state}`);
  return [
    world.copper,
    world.honor,
    world.heroicMarks,
    inv,
    sorted(Object.values(world.equipment).filter((id): id is string => !!id)),
    world.vendorBuyback.map((s) => `${s.itemId}:${s.count}`).join(','),
    record(world.factions),
    record(world.factionCurrencies),
    record(world.gatheringProficiency),
    quests.sort().join(','),
    world.questsDone.size,
    world.ridingTrainingTier(),
    sorted(identity.knownRecipes),
    record(identity.craftSkills),
    sorted(world.stationPlacements.map((st) => `${st.id}:${st.type}`)),
    world.ownedBuddies().length + world.pendingBuddies().length,
    sorted(learns.pendingIds(nowMs)),
    sorted(learns.confirmedIds(identity.knownRecipes)),
  ].join('|');
}

/** Whether any service-window root is shown. */
export function serviceWindowShown(doc: Document = document): boolean {
  return SERVICE_ROOT_IDS.some((id) => doc.getElementById(id)?.style.display === 'block');
}

/** A live interaction a rebuild must not run under: the custom-amount buy
 *  prompt or the shared confirm dialog (purchase and unbind confirms). */
export function serviceInteractionOpen(doc: Document = document): boolean {
  return (
    doc.querySelector('.buy-quantity-prompt') !== null ||
    doc.getElementById('confirm-dialog') !== null
  );
}

export class ServiceWindowRefresh {
  private lastSig: string | null = null;

  /** `repaint` is Hud.repaintOpenServiceWindows, which re-latches through
   *  {@link relatch}, so an explicit repaint never earns a second rebuild. */
  constructor(private readonly repaint: () => void) {}

  /** The slow-band poll: repaint the open family when its data moved.
   *  Returns whether it repainted. */
  refreshIfChanged(
    world: ServiceWindowWorld,
    learns: ServiceTrainLearns,
    nowMs: number,
    anyOpen = serviceWindowShown(),
  ): boolean {
    if (!anyOpen) {
      this.lastSig = null;
      return false;
    }
    if (serviceInteractionOpen()) return false;
    const sig = serviceWindowSig(world, learns, nowMs);
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    this.repaint();
    return true;
  }

  /** Re-latch after an explicit repaint (the action events, the inventory
   *  hook, the language switch), so the next poll does not rebuild again. */
  relatch(
    world: ServiceWindowWorld,
    learns: ServiceTrainLearns,
    nowMs: number,
    anyOpen = serviceWindowShown(),
  ): void {
    this.lastSig = anyOpen ? serviceWindowSig(world, learns, nowMs) : null;
  }
}
