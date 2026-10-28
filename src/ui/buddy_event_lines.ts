// The chat lines for the two text-free buddy events (src/sim/types.ts
// buddyPresence / buddyRevealed): a pure plan the HUD
// paints, so the wording and colour are unit-pinned away from the coordinator.
// Each line lands twice: the durable chat entry and an on-screen banner, so
// the player actually sees it mid-fight or on the walk out.
//
// The presence line is the whole point of the boss-pet reveal (owner plan):
// the player reads that something is watching them, and only on the walk out
// does the companion show itself. Each companion carries its own line
// (hudChrome.collections.presence.<key>); a companion without one falls back
// to the shared line, so a new catalog entry never paints a raw key.

import { buddyTemplateId } from '../sim/content/buddy_mobs';
import { tEntity } from './entity_i18n';
import { type TranslationKey, t, tOptional } from './i18n';

export interface BuddyEventLine {
  text: string;
  color: string;
}

export const BUDDY_PRESENCE_COLOR = '#c8a8ff';
export const BUDDY_REVEAL_COLOR = '#ffd100';

/** The follower's localized name, through the same mob entity key the
 *  nameplate reads (src/ui/world_entity_i18n.ts). */
export function buddyDisplayName(key: string): string {
  return tEntity({ kind: 'mob', id: buddyTemplateId(key as never), field: 'name' });
}

export function buddyPresenceLine(key: string): BuddyEventLine {
  const own = `hudChrome.collections.presence.${key}` as TranslationKey;
  const text = tOptional(own) ?? t('hudChrome.collections.presenceDefault');
  return { text, color: BUDDY_PRESENCE_COLOR };
}

export function buddyRevealedLine(key: string): BuddyEventLine {
  return {
    text: t('hudChrome.collections.revealed', { name: buddyDisplayName(key) }),
    color: BUDDY_REVEAL_COLOR,
  };
}

type BuddyEvent = Parameters<typeof buddyEventLine>[0];

/** The HUD's log() arguments for one event: `this.log(...buddyEventLogArgs(ev))`. */
export function buddyEventLogArgs(ev: BuddyEvent): [string, string] {
  const line = buddyEventLine(ev);
  return [line.text, line.color];
}

/** How long a buddy banner holds the slot. A sentence needs longer than the
 *  2600ms default, but an ambient banner (the zone name on the walk out)
 *  parked behind it must still be fresh when the slot frees, so this stays
 *  under AMBIENT_MAX_DEFER_MS less the advance gap (src/ui/banner_queue.ts;
 *  pinned in tests/buddy_event_lines.test.ts). */
export const BUDDY_BANNER_MS = 3500;

/** The HUD's showBanner() arguments for one event. Queued as a 'loot'
 *  celebration (src/ui/banner_queue.ts): the presence line lands on the boss
 *  kill beside loot and deed banners, and the reveal lands on the zone-out
 *  beside the zone-name banner, so an ambient banner would be replaced
 *  before it could be read. The loot class also carries the sentence-sized
 *  banner style. Login reveals (buddy_drops.ts revealBuddiesOnJoin) paint
 *  too: today that is only a companion left pending by a mid-instance
 *  logout, and the bounded queue caps any larger catch-up burst. */
export function buddyEventBannerArgs(ev: BuddyEvent) {
  return [
    buddyEventLine(ev).text,
    true,
    undefined,
    'default',
    undefined,
    BUDDY_BANNER_MS,
    null,
    'loot',
  ] as const;
}

/** The two HUD sinks one buddy event paints into. */
export interface BuddyEventHost {
  log(
    text: string,
    color: string,
    decorativeIconUrl: undefined,
    channel: undefined,
    announceWhenFiltered: boolean,
  ): void;
  showBanner(...args: ReturnType<typeof buddyEventBannerArgs>): unknown;
}

/** Paint one buddy event: the chat line first (the durable record a dropped
 *  banner falls back to), then the on-screen banner. The banner is not a
 *  live region, so the line is announced even when its chat channel is
 *  filtered: a screen-reader user gets what a sighted player sees. */
export function showBuddyEvent(host: BuddyEventHost, ev: BuddyEvent): void {
  host.log(...buddyEventLogArgs(ev), undefined, undefined, true);
  host.showBanner(...buddyEventBannerArgs(ev));
}

/** One entry point for the HUD's event switch. */
export function buddyEventLine(
  ev: { type: 'buddyPresence'; key: string } | { type: 'buddyRevealed'; key: string },
): BuddyEventLine {
  switch (ev.type) {
    case 'buddyPresence':
      return buddyPresenceLine(ev.key);
    case 'buddyRevealed':
      return buddyRevealedLine(ev.key);
  }
}
