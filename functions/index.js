/*
 * Pundo Cloud Functions (region asia-southeast1).
 *
 *   checkSubscription  - called by the app after a purchase, on sign-in and when access lapses.
 *                        Verifies Google Play purchases with the Google Play Developer API and
 *                        writes entitlements/{uid} { activeUntil, ... }. firestore.rules lets a user
 *                        upload to the cloud only while activeUntil is in the future.
 *   playNotifications  - optional: Google Play real-time developer notifications (Pub/Sub topic
 *                        "play-billing") so renewals, cancellations and refunds update right away.
 *
 * Deploy: see BILLING_SETUP.md.
 */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');
const E = require('./entitlement');
const FREE = require('./free-access.json');

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 5 });
initializeApp();
const db = getFirestore();

const PACKAGE = 'org.mgocandoniaccounting.pundo';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE;
const FREE_UNTIL = Date.parse('2100-01-01T00:00:00Z');
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function play(path, method) {
  const client = await googleAuth.getClient();
  const res = await client.request({ url: API + path, method: method || 'GET', data: method === 'POST' ? {} : undefined });
  return res.data;
}

function toClient(d) {
  if (!d || !d.activeUntil) return { active: false };
  const until = d.activeUntil.toMillis ? d.activeUntil.toMillis() : d.activeUntil;
  return { active: until > Date.now(), activeUntil: until, source: d.source || 'play', autoRenewing: !!d.autoRenewing };
}

async function verifyPurchase(uid, token, productId) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new HttpsError('invalid-argument', 'Invalid purchase.');
  let sub;
  try {
    sub = await play('/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token));
  } catch (err) {
    const code = err.response && err.response.status;
    logger.warn('Play lookup failed', { code, msg: err.message });
    if (code === 400 || code === 404 || code === 410) throw new HttpsError('invalid-argument', 'Google Play does not recognise this purchase.');
    if (code === 401 || code === 403) throw new HttpsError('failed-precondition', 'The server is not allowed to check purchases yet (Play Console API access).');
    throw new HttpsError('unavailable', 'Could not reach Google Play. Try again later.');
  }
  const tag = E.accountTag(sub);
  if (tag && tag !== sha256(uid)) throw new HttpsError('permission-denied', 'This purchase belongs to a different Pundo account.');
  const ent = E.fromPlay(sub, Date.now());
  if (!ent.productId || (productId && !E.PRODUCTS.includes(productId))) throw new HttpsError('invalid-argument', 'This is not a Pundo sync subscription.');

  const tokenHash = sha256(token);
  const tokenRef = db.doc('purchases/' + tokenHash);
  const entRef = db.doc('entitlements/' + uid);
  await db.runTransaction(async (tx) => {
    const [owner, existing] = await Promise.all([tx.get(tokenRef), tx.get(entRef)]);
    if (owner.exists && owner.data().uid !== uid) throw new HttpsError('permission-denied', 'This purchase is already linked to a different Pundo account.');
    tx.set(tokenRef, { uid, productId: ent.productId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const prev = existing.exists ? existing.data() : null;
    const next = { tokenHash, activeUntil: ent.activeUntil };
    if (E.shouldReplace(prev && { source: prev.source, tokenHash: prev.tokenHash, activeUntil: prev.activeUntil && prev.activeUntil.toMillis() }, next)) {
      tx.set(entRef, {
        source: 'play', state: ent.state, productId: ent.productId, autoRenewing: ent.autoRenewing, test: ent.test,
        tokenHash, activeUntil: Timestamp.fromMillis(ent.activeUntil || 0), updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  if (E.needsAcknowledge(sub)) {
    try { await play('/purchases/subscriptions/' + encodeURIComponent(ent.productId) + '/tokens/' + encodeURIComponent(token) + ':acknowledge', 'POST'); }
    catch (err) { logger.error('Acknowledge failed (the app will retry)', { msg: err.message }); }
  }
  return ent;
}

exports.checkSubscription = onCall(async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const entRef = db.doc('entitlements/' + uid);
  const token = req.auth.token || {};

  if (E.isFree(FREE, uid, token.email, token.email_verified)) {
    await entRef.set({ source: 'free', state: 'FREE', activeUntil: Timestamp.fromMillis(FREE_UNTIL), updatedAt: FieldValue.serverTimestamp() });
    return { active: true, activeUntil: FREE_UNTIL, source: 'free' };
  }

  const purchases = Array.isArray(req.data && req.data.purchases) ? req.data.purchases.slice(0, 5) : [];
  let lastError = null;
  for (const p of purchases) {
    try { await verifyPurchase(uid, p && p.purchaseToken, p && p.productId); }
    catch (err) { lastError = err; }
  }
  const snap = await entRef.get();
  const result = toClient(snap.exists ? snap.data() : null);
  if (!result.active && lastError) throw lastError;
  return result;
});

exports.playNotifications = onMessagePublished('play-billing', async (event) => {
  const msg = event.data.message.json || {};
  const n = msg.subscriptionNotification;
  if (!n || !n.purchaseToken) return;
  const owner = await db.doc('purchases/' + sha256(n.purchaseToken)).get();
  if (!owner.exists) { logger.info('Notification for a purchase not linked yet'); return; }
  try { await verifyPurchase(owner.data().uid, n.purchaseToken, n.subscriptionId); }
  catch (err) { logger.error('Could not update from notification', { msg: err.message }); }
});
