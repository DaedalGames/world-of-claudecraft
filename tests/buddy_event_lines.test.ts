import { describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import {
  AMBIENT_MAX_DEFER_MS,
  BANNER_ADVANCE_GAP_MS,
  type BannerClass,
  BannerQueue,
  isBannerStale,
} from '../src/ui/banner_queue';
import {
  BUDDY_BANNER_MS,
  BUDDY_PRESENCE_COLOR,
  BUDDY_REVEAL_COLOR,
  buddyDisplayName,
  buddyEventBannerArgs,
  buddyEventLine,
  showBuddyEvent,
} from '../src/ui/buddy_event_lines';
import { setLanguage } from '../src/ui/i18n';

describe('buddy event chat lines', () => {
  it('every companion has its own presence line, in the presence colour', () => {
    setLanguage('en');
    const seen = new Set<string>();
    for (const key of BUDDY_KEYS) {
      const line = buddyEventLine({ type: 'buddyPresence', key });
      expect(line.color).toBe(BUDDY_PRESENCE_COLOR);
      expect(line.text.length).toBeGreaterThan(10);
      expect(line.text).not.toContain('hudChrome.');
      seen.add(line.text);
    }
    // "Different for each pet" (owner plan): no two companions share a line.
    expect(seen.size).toBe(BUDDY_KEYS.length);
  });

  it('an unknown key falls back to the shared line rather than a raw key', () => {
    setLanguage('en');
    const line = buddyEventLine({ type: 'buddyPresence', key: 'not_a_buddy' });
    expect(line.text).toBe('You feel a presence watching you.');
  });

  it('the reveal line names the companion by its localized mob name', () => {
    setLanguage('en');
    const line = buddyEventLine({ type: 'buddyRevealed', key: 'crystal_lich' });
    expect(line.text).toBe(`${buddyDisplayName('crystal_lich')} has decided to follow you.`);
    expect(line.color).toBe(BUDDY_REVEAL_COLOR);
  });
});

describe('buddy event on-screen banner', () => {
  it('paints the same line as the chat entry, queued as a loot celebration', () => {
    setLanguage('en');
    for (const ev of [
      { type: 'buddyPresence', key: 'ember_fox' },
      { type: 'buddyRevealed', key: 'ember_fox' },
    ] as const) {
      const args = buddyEventBannerArgs(ev);
      expect(args[0]).toBe(buddyEventLine(ev).text);
      // 'loot', never 'ambient': the reveal lands beside the zone-name banner
      // on the walk out, which would replace an ambient banner immediately.
      expect(args[7]).toBe('loot');
      expect(args[5]).toBe(BUDDY_BANNER_MS);
    }
  });

  it('a zone-name banner parked behind it is still fresh when the slot frees', () => {
    // The reveal and the zone change can land in the same frame: the loot
    // banner takes the slot and the ambient zone name parks behind it.
    const queue = new BannerQueue<{ bannerClass: BannerClass; enqueuedAt: number }>();
    expect(queue.enqueue('loot', { bannerClass: 'loot', enqueuedAt: 0 })).toBe('show');
    const zone = { bannerClass: 'ambient' as const, enqueuedAt: 0 };
    expect(queue.enqueue('ambient', zone)).toBe('queued');
    const freedAt = BUDDY_BANNER_MS + BANNER_ADVANCE_GAP_MS;
    expect(freedAt).toBeLessThanOrEqual(AMBIENT_MAX_DEFER_MS);
    expect(isBannerStale(zone, freedAt)).toBe(false);
  });

  it('showBuddyEvent writes the chat line first, then the banner', () => {
    setLanguage('en');
    const calls: string[] = [];
    const ev = { type: 'buddyPresence', key: 'frog' } as const;
    showBuddyEvent(
      {
        log: (text, color, _icon, _channel, announceWhenFiltered) =>
          calls.push(`log|${text}|${color}|${announceWhenFiltered}`),
        showBanner: (text, ...rest) => calls.push(`banner|${text}|${rest[6]}`),
      },
      ev,
    );
    const text = buddyEventLine(ev).text;
    // announceWhenFiltered: the banner is not a live region, so a filtered
    // chat channel must still reach the screen reader.
    expect(calls).toEqual([`log|${text}|${BUDDY_PRESENCE_COLOR}|true`, `banner|${text}|loot`]);
  });
});
