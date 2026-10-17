/*
 * Turns a Google Play subscription (purchases.subscriptionsv2 resource) into Pundo's sync access.
 * No dependencies so it can be unit tested.
 */
'use strict';

const PRODUCTS = ['pundo_sync'];

// States in which the subscriber has paid for the current period.
const PAID = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
const DAY = 24 * 60 * 60 * 1000;

/** @returns {{active, activeUntil, state, productId, autoRenewing, test}} activeUntil in ms */
function fromPlay(sub, now) {
  const items = (sub && sub.lineItems || []).filter((li) => PRODUCTS.includes(li.productId));
  const state = (sub && sub.subscriptionState) || 'SUBSCRIPTION_STATE_UNSPECIFIED';
  let expiry = 0;
  let productId = items.length ? items[0].productId : null;
  let autoRenewing = false;
  for (const li of items) {
    const t = Date.parse(li.expiryTime || '') || 0;
    if (t > expiry) { expiry = t; productId = li.productId; }
    if (li.autoRenewingPlan && li.autoRenewingPlan.autoRenewEnabled) autoRenewing = true;
  }
  let activeUntil = PAID.includes(state) ? expiry : 0;
  // Keep access through a grace period even if Google still reports the old expiry.
  if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') activeUntil = Math.max(activeUntil, now + DAY);
  return {
    active: activeUntil > now,
    activeUntil,
    state,
    productId,
    autoRenewing: autoRenewing && state !== 'SUBSCRIPTION_STATE_CANCELED',
    test: !!(sub && sub.testPurchase),
  };
}

/** Whose purchase is this? The app tags each purchase with sha256(uid). */
function accountTag(sub) {
  const ids = sub && sub.externalAccountIdentifiers;
  return (ids && ids.obfuscatedExternalAccountId) || null;
}

function needsAcknowledge(sub) {
  return !!sub && sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' &&
    ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'].includes(sub.subscriptionState);
}

/**
 * Should a newly checked purchase replace what is stored? Never downgrade free access, and don't
 * let an old, expired purchase overwrite a newer one (only the same purchase may shorten access).
 */
function shouldReplace(existing, next) {
  if (!existing) return true;
  if (existing.source === 'free') return false;
  if (existing.tokenHash && existing.tokenHash === next.tokenHash) return true;
  return next.activeUntil >= (existing.activeUntil || 0);
}

function isFree(list, uid, email, emailVerified) {
  if ((list.uids || []).includes(uid)) return true;
  const e = String(email || '').toLowerCase();
  return !!(e && emailVerified && (list.verifiedEmails || []).map((x) => x.toLowerCase()).includes(e));
}

module.exports = { PRODUCTS, fromPlay, accountTag, needsAcknowledge, shouldReplace, isFree };
