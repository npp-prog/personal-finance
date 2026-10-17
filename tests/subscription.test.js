'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../functions/entitlement');

const NOW = Date.parse('2026-10-18T00:00:00Z');
const DAY = 86400000;
const sub = (state, expiryMs, extra) => Object.assign({
  subscriptionState: state,
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  lineItems: [{ productId: 'pundo_sync', expiryTime: new Date(expiryMs).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
}, extra || {});

test('active and cancelled-but-paid subscriptions give access until expiry', () => {
  const a = E.fromPlay(sub('SUBSCRIPTION_STATE_ACTIVE', NOW + 10 * DAY), NOW);
  assert.strictEqual(a.active, true);
  assert.strictEqual(a.activeUntil, NOW + 10 * DAY);
  assert.strictEqual(a.autoRenewing, true);
  const c = E.fromPlay(sub('SUBSCRIPTION_STATE_CANCELED', NOW + 3 * DAY), NOW);
  assert.strictEqual(c.active, true);
  assert.strictEqual(c.autoRenewing, false);
});

test('expired, on hold, paused and pending give no access', () => {
  for (const s of ['SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_PENDING']) {
    const r = E.fromPlay(sub(s, NOW + 5 * DAY), NOW);
    assert.strictEqual(r.active, false, s);
    assert.strictEqual(r.activeUntil, 0, s);
  }
  assert.strictEqual(E.fromPlay(sub('SUBSCRIPTION_STATE_ACTIVE', NOW - DAY), NOW).active, false);
});

test('grace period keeps access for at least a day', () => {
  const r = E.fromPlay(sub('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', NOW - DAY), NOW);
  assert.strictEqual(r.active, true);
  assert.ok(r.activeUntil >= NOW + DAY);
});

test('other products are ignored', () => {
  const r = E.fromPlay({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: 'something_else', expiryTime: new Date(NOW + DAY).toISOString() }] }, NOW);
  assert.strictEqual(r.productId, null);
  assert.strictEqual(r.active, false);
});

test('account tag and acknowledgement', () => {
  assert.strictEqual(E.accountTag(sub('SUBSCRIPTION_STATE_ACTIVE', NOW, { externalAccountIdentifiers: { obfuscatedExternalAccountId: 'abc' } })), 'abc');
  assert.strictEqual(E.accountTag(sub('SUBSCRIPTION_STATE_ACTIVE', NOW)), null);
  assert.strictEqual(E.needsAcknowledge(sub('SUBSCRIPTION_STATE_ACTIVE', NOW, { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' })), true);
  assert.strictEqual(E.needsAcknowledge(sub('SUBSCRIPTION_STATE_ACTIVE', NOW)), false);
  assert.strictEqual(E.needsAcknowledge(sub('SUBSCRIPTION_STATE_PENDING', NOW, { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' })), false);
});

test('an old purchase never shortens a newer one; free access is never replaced', () => {
  assert.strictEqual(E.shouldReplace(null, { tokenHash: 'a', activeUntil: 1 }), true);
  assert.strictEqual(E.shouldReplace({ source: 'free', activeUntil: 9 }, { tokenHash: 'a', activeUntil: 99 }), false);
  assert.strictEqual(E.shouldReplace({ source: 'play', tokenHash: 'new', activeUntil: 100 }, { tokenHash: 'old', activeUntil: 0 }), false);
  assert.strictEqual(E.shouldReplace({ source: 'play', tokenHash: 'same', activeUntil: 100 }, { tokenHash: 'same', activeUntil: 0 }), true);
  assert.strictEqual(E.shouldReplace({ source: 'play', tokenHash: 'old', activeUntil: 100 }, { tokenHash: 'new', activeUntil: 200 }), true);
});

test('free access list', () => {
  const list = { uids: ['u1'], verifiedEmails: ['Owner@Example.com'] };
  assert.strictEqual(E.isFree(list, 'u1', '', false), true);
  assert.strictEqual(E.isFree(list, 'u2', 'owner@example.com', true), true);
  assert.strictEqual(E.isFree(list, 'u2', 'owner@example.com', false), false);
  assert.strictEqual(E.isFree(list, 'u2', 'x@example.com', true), false);
});
