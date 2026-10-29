// The two store-purchase dialogs over the pure core in purchase_reward_view.ts.
// The loot window lists every paid parcel waiting for this character and takes
// them through the ordinary IWorld mailTake, which the sim lets a purchase parcel
// use anywhere and past full bags (src/sim/mail/purchase_parcels.ts). "Later"
// leaves the parcel in the mailbox. The congratulation follows a redeemed
// membership token (server event) or a completed membership checkout.

import type { PurchaseParcelView } from '../sim/mail/purchase_parcels';
import { esc } from './esc';
import { t } from './i18n';
import { installPromptDialog } from './prompt_dialog';
import {
  membershipWelcomeBody,
  mergePurchaseParcels,
  purchaseLootRows,
} from './purchase_reward_view';
import { releaseStorePromptHost, resolveStorePromptHost } from './store_prompt_host';

/** The window blocked behind a purchase dialog: the WOC Store, where purchases start. */
function storeWindow(): HTMLElement {
  return document.getElementById('daily-rewards-window') ?? document.body;
}

interface OpenDialog {
  prompt: HTMLElement;
  dismiss: () => void;
}

/** Mounts one dialog on the prompt host above the open windows; returns null when
 *  the page has no prompt host. */
function mountDialog(
  className: string,
  html: string,
  idPrefix: string,
  onClose: () => void,
): OpenDialog | null {
  const host = resolveStorePromptHost();
  if (!host) return null;
  const prompt = document.createElement('div');
  prompt.className = `prompt panel ui-window purchase-reward-prompt ${className}`;
  prompt.innerHTML = html;
  let dismissed = false;
  const handle = installPromptDialog(
    prompt,
    null,
    () => {
      if (dismissed) return;
      dismissed = true;
      prompt.remove();
      // A Store decision may share the host: keep the lift while any prompt remains.
      if (!host.querySelector('.prompt')) host.classList.remove('store-decision-active');
      releaseStorePromptHost(host);
      onClose();
    },
    { inertRoot: storeWindow(), idPrefix },
  );
  host.classList.add('store-decision-active');
  host.append(prompt);
  return { prompt, dismiss: handle.dismiss };
}

export function showMembershipWelcome(expiresAt: number | null): void {
  const dialog = mountDialog(
    'membership-welcome-prompt',
    `<h3 class="prompt-text">${esc(t('hudChrome.membershipWelcome.title'))}</h3>` +
      `<p class="purchase-reward-description">${esc(membershipWelcomeBody(expiresAt))}</p>` +
      `<div class="purchase-reward-actions"><button type="button" class="btn purchase-reward-ok">${esc(t('hudChrome.membershipWelcome.close'))}</button></div>`,
    'membership-welcome-title',
    () => {},
  );
  if (!dialog) return;
  const ok = dialog.prompt.querySelector<HTMLButtonElement>('.purchase-reward-ok')!;
  ok.classList.replace('ui-btn--red', 'ui-btn--gold');
  ok.addEventListener('click', dialog.dismiss);
  ok.focus();
}

export class PurchaseRewardDialogs {
  private parcels: PurchaseParcelView[] = [];
  private open: OpenDialog | null = null;

  constructor(private readonly take: (mailId: number) => void) {}

  /** A parcel landed or still waits: open the loot window, or add it to the open one. */
  offer(parcels: readonly PurchaseParcelView[]): void {
    this.parcels = mergePurchaseParcels(this.parcels, parcels);
    if (this.parcels.length === 0) return;
    this.open?.dismiss();
    this.open = mountDialog('purchase-loot-prompt', this.lootHtml(), 'purchase-loot-title', () => {
      this.open = null;
    });
    if (!this.open) return;
    const { prompt, dismiss } = this.open;
    const collect = prompt.querySelector<HTMLButtonElement>('.purchase-reward-collect')!;
    collect.classList.replace('ui-btn--red', 'ui-btn--gold');
    collect.addEventListener('click', () => {
      const taken = this.parcels;
      this.parcels = [];
      dismiss();
      for (const parcel of taken) this.take(parcel.mailId);
    });
    prompt.querySelector('.purchase-reward-later')!.addEventListener('click', () => {
      // Later keeps them in the mailbox; the next login offers them again.
      this.parcels = [];
      dismiss();
    });
    collect.focus();
  }

  private lootHtml(): string {
    const rows = purchaseLootRows(this.parcels)
      .map(
        (row) =>
          '<li class="purchase-loot-row">' +
          (row.image ? `<img src="${esc(row.image)}" alt="" width="40" height="40">` : '') +
          `<span class="purchase-loot-name q-${row.quality}">${esc(row.name)}</span>` +
          (row.count ? `<span class="purchase-loot-count">${esc(row.count)}</span>` : '') +
          '</li>',
      )
      .join('');
    return (
      `<h3 class="prompt-text">${esc(t('hudChrome.purchaseLoot.title'))}</h3>` +
      `<ul class="purchase-loot-items">${rows}</ul>` +
      `<p class="purchase-reward-description">${esc(t('hudChrome.purchaseLoot.description'))}</p>` +
      '<div class="purchase-reward-actions">' +
      `<button type="button" class="btn purchase-reward-collect">${esc(t('hudChrome.purchaseLoot.collect'))}</button>` +
      `<button type="button" class="btn purchase-reward-later">${esc(t('hudChrome.purchaseLoot.later'))}</button>` +
      '</div>'
    );
  }
}
