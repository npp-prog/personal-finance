/*
 * Pundo cloud sync (Firebase Auth + Cloud Firestore).
 *
 * Data model (per user):
 *   users/{uid}/meta/book        { json, updatedAt, serverAt }   accounts, people, currency, name
 *   users/{uid}/entries/{id}     { json|null, deleted, updatedAt, serverAt }   one per journal entry
 *
 * Rules of the road:
 *   - Last write wins, using each change's updatedAt (ISO time from the device that made it).
 *   - Deletions travel as tombstones (deleted: true) so other devices remove the entry too.
 *   - The first time a device links to an account, its accounts/people are merged with the
 *     cloud's (nothing is thrown away); after that the newest meta wins.
 *   - Firestore queues writes while offline and sends them when the connection returns.
 *
 * Sync is a paid add-on (window.PUNDO_SUBSCRIPTION): uploading needs entitlements/{uid} with
 * activeUntil in the future. Only the checkSubscription Cloud Function writes it, after verifying the
 * Google Play purchase (or for accounts on the free list). Without it the device keeps working
 * offline and sync pauses; firestore.rules enforce the same thing on the server.
 *
 * The app talks to this module through window.PundoSync; the backend is a small adapter so the
 * engine can be tested without Firebase (window.__PUNDO_TEST_CLOUD__).
 */
(function () {
  'use strict';

  const STATE_KEY = 'pf-ledger-sync-v1';
  const VENDOR = ['vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js', 'vendor/firebase/firebase-functions-compat.js'];

  let api = null;          // hooks provided by the app
  let adapter = null;      // backend (Firebase or test double)
  let adapterPromise = null;
  let user = null;         // { uid, email, verified }
  let unsubscribe = null;
  let pushTimer = null;
  let pushing = false;
  let pushAgain = false;
  let metaChecked = false; // first remote meta snapshot handled (needed before pushing meta on first link)
  const echo = new Map();  // id -> updatedAt applied from the cloud (don't push it straight back)
  const status = { state: 'off', lastSyncAt: null, error: '' };
  let entUnsub = null;     // entitlement listener
  let entTimer = null;     // re-check when access runs out
  let restoreTried = false;
  let sub = { known: false, active: false, activeUntil: 0, source: '', autoRenewing: false };
  let state = loadState();

  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (e) { return {}; } }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function config() { const c = window.PUNDO_FIREBASE_CONFIG; return c && c.apiKey && c.projectId ? c : null; }
  function subConfig() { return Object.assign({ required: false, productId: 'pundo_sync', price: '', functionsRegion: 'us-central1' }, window.PUNDO_SUBSCRIPTION || {}); }
  // The paywall applies when it is switched on and the backend knows about entitlements.
  function paywall() { return !!(subConfig().required && adapter && adapter.watchEntitlement); }
  function billing() {
    const C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.PundoBilling) || window.__PUNDO_TEST_BILLING__ || null;
  }
  async function accountTag(uid) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
    return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function setStatus(s, extra) { Object.assign(status, { state: s }, extra || {}); if (api) api.onStatus(); }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      const el = document.createElement('script');
      el.src = src; el.async = false; el.dataset.src = src;
      el.onload = resolve; el.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(el);
    });
  }

  // ---------------------------------------------------------------------------
  // Firebase adapter
  // ---------------------------------------------------------------------------

  async function createFirebaseAdapter(cfg) {
    for (const src of VENDOR) await loadScript(src);
    const fb = window.firebase;
    if (!fb.apps.length) fb.initializeApp(cfg);
    const auth = fb.auth();
    const db = fb.firestore();
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* another tab or unsupported: still works online */ }
    const serverTime = () => fb.firestore.FieldValue.serverTimestamp();
    const entryRef = (uid, id) => db.doc('users/' + uid + '/entries/' + id);
    const metaRef = (uid) => db.doc('users/' + uid + '/meta/book');
    const toUser = (u) => (u ? { uid: u.uid, email: u.email, verified: !!u.emailVerified, providers: (u.providerData || []).map((p) => p.providerId) } : null);
    // Google sign-in: native account picker in the Android app (Google blocks sign-in pages inside
    // app web views), the standard pop-up in a browser.
    const nativeAuth = () => {
      const C = window.Capacitor;
      return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.FirebaseAuthentication;
    };
    const googleCredential = async () => {
      const r = await nativeAuth().signInWithGoogle();
      const idToken = r && r.credential && r.credential.idToken;
      if (!idToken) throw Object.assign(new Error('Google did not return a sign-in token.'), { code: 'google/no-token' });
      return fb.auth.GoogleAuthProvider.credential(idToken);
    };
    const googleProvider = () => { const p = new fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; };

    return {
      onAuth: (cb) => auth.onAuthStateChanged((u) => cb(toUser(u))),
      async signUp(email, password) {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        try { await cred.user.sendEmailVerification(); } catch (e) { /* optional */ }
      },
      signIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
      async signInWithGoogle() {
        if (nativeAuth()) return auth.signInWithCredential(await googleCredential());
        try { return await auth.signInWithPopup(googleProvider()); }
        catch (err) {
          if (err && err.code === 'auth/popup-blocked') return auth.signInWithRedirect(googleProvider());
          throw err;
        }
      },
      resetPassword: (email) => auth.sendPasswordResetEmail(email),
      async signOut() {
        if (nativeAuth()) { try { await nativeAuth().signOut(); } catch (e) { /* not signed in natively */ } }
        await auth.signOut();
      },
      async write(uid, ops, meta) {
        // Firestore batches hold up to 500 writes.
        for (let i = 0; i < Math.max(ops.length, meta ? 1 : 0); i += 450) {
          const batch = db.batch();
          for (const o of ops.slice(i, i + 450)) {
            batch.set(entryRef(uid, o.id), { json: o.json, deleted: o.json == null, updatedAt: o.updatedAt, serverAt: serverTime() });
          }
          if (meta && i === 0) batch.set(metaRef(uid), { json: meta.json, updatedAt: meta.updatedAt, serverAt: serverTime() });
          await batch.commit();
        }
      },
      listen(uid, sinceMs, onChange, onError) {
        const since = fb.firestore.Timestamp.fromMillis(sinceMs || 0);
        const u1 = db.collection('users/' + uid + '/entries').where('serverAt', '>', since).onSnapshot((snap) => {
          const entries = [];
          snap.docChanges().forEach((ch) => {
            if (ch.type === 'removed') return;
            const d = ch.doc.data({ serverTimestamps: 'estimate' });
            entries.push({ id: ch.doc.id, json: d.json || null, deleted: !!d.deleted, updatedAt: d.updatedAt || '', serverMs: d.serverAt ? d.serverAt.toMillis() : 0 });
          });
          if (entries.length) onChange({ entries });
        }, onError);
        const u2 = metaRef(uid).onSnapshot((s) => {
          if (!s.exists) return onChange({ meta: null });
          const d = s.data({ serverTimestamps: 'estimate' });
          onChange({ meta: { json: d.json, updatedAt: d.updatedAt || '' } });
        }, onError);
        return () => { u1(); u2(); };
      },
      async deleteAllData(uid) {
        for (;;) {
          const snap = await db.collection('users/' + uid + '/entries').limit(400).get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        await metaRef(uid).delete();
      },
      async reauthenticate(password) {
        const u = auth.currentUser;
        const viaGoogle = (u.providerData || []).some((p) => p.providerId === 'google.com') && !password;
        if (viaGoogle) {
          if (nativeAuth()) await u.reauthenticateWithCredential(await googleCredential());
          else await u.reauthenticateWithPopup(googleProvider());
          return;
        }
        await u.reauthenticateWithCredential(fb.auth.EmailAuthProvider.credential(u.email, password));
      },
      deleteUser: () => auth.currentUser.delete(),
      watchEntitlement(uid, cb) {
        return db.doc('entitlements/' + uid).onSnapshot((s) => {
          const d = s.exists ? s.data() : null;
          cb(d && d.activeUntil ? { activeUntil: d.activeUntil.toMillis(), source: d.source || 'play', autoRenewing: !!d.autoRenewing } : null);
        }, () => cb(null));
      },
      async checkSubscription(purchases) {
        const call = fb.app().functions(subConfig().functionsRegion).httpsCallable('checkSubscription');
        return (await call({ purchases })).data;
      },
    };
  }

  function ensureAdapter() {
    if (adapter) return Promise.resolve(adapter);
    if (adapterPromise) return adapterPromise;
    const cfg = config();
    const test = window.__PUNDO_TEST_CLOUD__;
    if (!test && !cfg) return Promise.resolve(null);
    adapterPromise = (test ? Promise.resolve(test) : createFirebaseAdapter(cfg)).then((a) => {
      adapter = a;
      adapter.onAuth(onAuthChange);
      return adapter;
    }).catch((err) => { adapterPromise = null; setStatus('error', { error: err.message }); return null; });
    return adapterPromise;
  }

  // ---------------------------------------------------------------------------
  // Engine
  // ---------------------------------------------------------------------------

  function onAuthChange(u) {
    user = u;
    if (!u) { stop(); stopEntitlement(); setStatus('signedout'); return; }
    if (state.uid !== u.uid) { state = { uid: u.uid, lastPulled: 0, lastPushed: '', first: true }; saveState(); }
    if (!paywall()) { start(); return; }
    stopEntitlement();
    sub = { known: false, active: false, activeUntil: 0, source: '', autoRenewing: false };
    restoreTried = false;
    setStatus('checking');
    entUnsub = adapter.watchEntitlement(u.uid, onEntitlement);
  }

  function stopEntitlement() {
    if (entUnsub) { try { entUnsub(); } catch (e) { /* ignore */ } }
    entUnsub = null;
    clearTimeout(entTimer);
  }

  function onEntitlement(e) {
    if (!user) return;
    const until = (e && e.activeUntil) || 0;
    sub = { known: true, active: until > Date.now(), activeUntil: until, source: (e && e.source) || '', autoRenewing: !!(e && e.autoRenewing) };
    clearTimeout(entTimer);
    if (sub.active) {
      restoreTried = false; // if it lapses later, ask the server again once (Play may have renewed it)
      // Re-evaluate when it runs out (timers can't wait more than ~24 days).
      entTimer = setTimeout(() => onEntitlement(e), Math.min(until - Date.now() + 1000, 2 ** 31 - 1));
      if (!unsubscribe) start(); else if (api) api.onStatus();
      return;
    }
    stop();
    setStatus('needsub', { error: '' });
    // Quietly ask the server once: picks up renewals, purchases made on another device and free access.
    if (!restoreTried) { restoreTried = true; refreshSubscription().catch(() => { /* stays paused */ }); }
  }

  /** Sends the Play purchases on this device (if any) to the server and returns the result. */
  async function refreshSubscription() {
    if (!adapter || !user || !adapter.checkSubscription) return { active: false };
    let purchases = [];
    const b = billing();
    if (b) {
      try {
        const r = await b.getPurchases();
        purchases = ((r && r.purchases) || []).filter((p) => p.purchaseToken).map((p) => ({ purchaseToken: p.purchaseToken, productId: p.productId }));
      } catch (e) { /* Play unavailable: still ask the server about free access */ }
    }
    const res = await adapter.checkSubscription(purchases);
    if (res && res.active) onEntitlement({ activeUntil: res.activeUntil, source: res.source, autoRenewing: res.autoRenewing });
    return res || { active: false };
  }

  function start() {
    stop();
    metaChecked = !state.first;
    setStatus(navigator.onLine === false ? 'offline' : 'syncing');
    unsubscribe = adapter.listen(state.uid, state.lastPulled || 0, onRemote, (err) => setStatus('error', { error: friendlyError(err) }));
    schedulePush(0);
  }

  function stop() {
    if (unsubscribe) { try { unsubscribe(); } catch (e) { /* ignore */ } }
    unsubscribe = null;
    clearTimeout(pushTimer);
  }

  function schedulePush(delay) {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay == null ? 1500 : delay);
  }

  async function push() {
    if (!user || !adapter) return;
    if (pushing) { pushAgain = true; return; }
    pushing = true;
    const mark = new Date().toISOString();
    const since = state.lastPushed || '';
    const book = api.getBook();
    const ops = [];
    for (const e of book.entries) {
      const at = e.updatedAt || mark;
      if (since && at <= since) continue;
      if (echo.get(e.id) === at) continue;
      ops.push({ id: e.id, json: JSON.stringify(e), updatedAt: at });
    }
    for (const t of book.tombstones || []) {
      if (since && t.at <= since) continue;
      if (echo.get(t.id) === t.at) continue;
      ops.push({ id: t.id, json: null, updatedAt: t.at });
    }
    let meta = null;
    const metaAt = book.metaUpdatedAt || '';
    if (metaChecked && (!since || metaAt > since)) meta = { json: JSON.stringify(api.metaOf(book)), updatedAt: metaAt || mark };
    try {
      if (ops.length || meta) {
        setStatus('syncing');
        await adapter.write(state.uid, ops, meta);
      }
      if (metaChecked) {
        state.lastPushed = mark;
        state.first = false;
        saveState();
        api.pruneTombstones(mark);
      }
      setStatus('synced', { lastSyncAt: new Date().toISOString(), error: '' });
    } catch (err) {
      if (paywall() && err && err.code === 'permission-denied') {
        // Most likely the subscription just ended: the entitlement listener will confirm.
        setStatus('needsub', { error: '' });
      } else {
        setStatus(navigator.onLine === false ? 'offline' : 'error', { error: friendlyError(err) });
      }
    } finally {
      pushing = false;
      if (pushAgain) { pushAgain = false; schedulePush(500); }
    }
  }

  function onRemote(change) {
    let maxServer = state.lastPulled || 0;
    let needsPush = false;
    api.applyRemote((book) => {
      if (change.entries) {
        const index = new Map(book.entries.map((e, i) => [e.id, i]));
        const removeIds = new Set();
        for (const r of change.entries) {
          maxServer = Math.max(maxServer, r.serverMs || 0);
          const i = index.get(r.id);
          const local = i == null ? null : book.entries[i];
          const localAt = local ? local.updatedAt || '' : '';
          const tomb = (book.tombstones || []).find((t) => t.id === r.id);
          if (tomb && tomb.at >= r.updatedAt) continue; // deleted here more recently
          if (r.deleted) {
            if (local && localAt <= r.updatedAt) removeIds.add(r.id);
            echo.set(r.id, r.updatedAt);
            continue;
          }
          if (local && localAt >= r.updatedAt) continue; // ours is newer (or the same)
          let entry;
          try { entry = JSON.parse(r.json); } catch (e) { continue; }
          entry.updatedAt = r.updatedAt;
          if (local) book.entries[i] = entry; else { book.entries.push(entry); index.set(entry.id, book.entries.length - 1); }
          echo.set(r.id, r.updatedAt);
        }
        if (removeIds.size) book.entries = book.entries.filter((e) => !removeIds.has(e.id));
      }
      if ('meta' in change) {
        const r = change.meta;
        const localAt = book.metaUpdatedAt || '';
        if (r && (!metaChecked || r.updatedAt > localAt)) {
          let remote;
          try { remote = JSON.parse(r.json); } catch (e) { remote = null; }
          if (remote) {
            if (!metaChecked) {
              // First link on this device: merge so nothing created offline is lost. If the merge
              // added anything the cloud doesn't have, stamp it as new so it gets uploaded.
              api.mergeMeta(book, remote, r.updatedAt > localAt);
              const sameAsCloud = JSON.stringify(api.metaOf(book)) === JSON.stringify(api.metaOf(Object.assign({}, book, remote)));
              book.metaUpdatedAt = sameAsCloud ? r.updatedAt : new Date().toISOString();
            } else {
              api.replaceMeta(book, remote);
              book.metaUpdatedAt = r.updatedAt;
            }
          }
        } else if (!r && !metaChecked) {
          needsPush = true; // nothing in the cloud yet: upload ours
        }
        if (!metaChecked) { metaChecked = true; needsPush = true; }
      }
    });
    if (maxServer > (state.lastPulled || 0)) { state.lastPulled = maxServer; saveState(); }
    if (needsPush) schedulePush(200);
    if (status.state === 'syncing' && !pushing) setStatus('synced', { lastSyncAt: new Date().toISOString(), error: '' });
  }

  function friendlyError(err) {
    const code = (err && (err.code || '')) + '';
    const map = {
      'auth/invalid-email': 'That email address is not valid.',
      'auth/user-not-found': 'No account with that email. Create one first.',
      'auth/wrong-password': 'Wrong email or password.',
      'auth/invalid-credential': 'Wrong email or password.',
      'auth/invalid-login-credentials': 'Wrong email or password.',
      'auth/email-already-in-use': 'An account with this email already exists — sign in instead.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No internet connection.',
      'auth/requires-recent-login': 'For your security, enter your password again.',
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      'auth/user-cancelled': '',
      'auth/unauthorized-domain': 'This website is not allowed to use Google sign-in yet. In Firebase: Authentication → Settings → Authorized domains → add this site\'s domain.',
      'auth/account-exists-with-different-credential': 'This email already has a Pundo account with a password. Sign in with your email and password instead.',
      'auth/internal-error': 'Could not start Google sign-in. In the Firebase console make sure Authentication is turned on (Authentication → Get started) and Google is enabled under Sign-in method.',
      'google/no-token': 'Google sign-in did not finish. Please try again.',
      'auth/configuration-not-found': 'Sign-in is not switched on yet. In the Firebase console open Authentication → Get started → Email/Password → Enable.',
      'auth/operation-not-allowed': 'Email/password sign-in is not enabled. In the Firebase console open Authentication → Sign-in method → Email/Password → Enable.',
      'permission-denied': 'The cloud refused access. Check the Firestore security rules, or sign out and sign in again.',
      'functions/permission-denied': 'This purchase belongs to a different Pundo account. Sign in with the account you subscribed with.',
      'functions/invalid-argument': 'Google Play does not recognise this purchase.',
      'functions/failed-precondition': 'Subscriptions are not fully set up on the server yet. Please try again later.',
      'functions/unavailable': 'Cannot reach the server right now. Please try again later.',
      'functions/not-found': 'Subscriptions are not set up on the server yet (Cloud Function not deployed).',
      'functions/internal': 'The server could not check your subscription. Please try again later.',
      cancelled: '',
      busy: 'A purchase is already in progress.',
      owned: 'You already have this subscription. Tap “Restore purchase”.',
      'billing-unavailable': 'Google Play billing is not available on this device. Make sure you are signed in to the Play Store.',
      'item-unavailable': 'The subscription is not available in Google Play yet.',
      'failed-precondition': 'The cloud database is not set up yet. In the Firebase console open Firestore Database → Create database.',
      unavailable: 'Cannot reach the cloud right now — changes are saved and will sync later.',
    };
    if (code in map) return map[code];
    const msg = String((err && err.message) || '');
    if (/cancel/i.test(msg)) return ''; // user closed the Google account picker
    if (/DEVELOPER_ERROR|\b10:|WILL_BE_OVERRIDDEN|No credentials available|default_web_client_id/i.test(msg)) {
      return 'Google sign-in is not fully set up yet. Enable Google in Firebase Authentication, add the app\'s SHA-1 fingerprints, and update google-services.json (see FIREBASE_SETUP.md).';
    }
    return msg || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.PundoSync = {
    /** Wire the app in. Loads Firebase only if this device has signed in before. */
    init(appApi) {
      api = appApi;
      if (!config() && !window.__PUNDO_TEST_CLOUD__) { setStatus('unavailable'); return; }
      setStatus(state.uid ? 'syncing' : 'signedout');
      if (state.uid) ensureAdapter();
      window.addEventListener('online', () => { if (user) { setStatus('syncing'); schedulePush(0); } });
      window.addEventListener('offline', () => { if (user) setStatus('offline'); });
    },
    available: () => !!(config() || window.__PUNDO_TEST_CLOUD__),
    isLinked: () => !!state.uid,
    user: () => user,
    status: () => Object.assign({}, status),
    prepare: ensureAdapter,
    localChanged() { if (user) schedulePush(); },
    syncNow() { if (user) { setStatus('syncing'); schedulePush(0); } },
    async signIn(email, password) { const a = await ensureAdapter(); if (!a) throw new Error('Sync is not available.'); await a.signIn(email, password); },
    async signUp(email, password) { const a = await ensureAdapter(); if (!a) throw new Error('Sync is not available.'); await a.signUp(email, password); },
    async signInWithGoogle() { const a = await ensureAdapter(); if (!a) throw new Error('Sync is not available.'); await a.signInWithGoogle(); },
    usesGoogle: () => !!(user && (user.providers || []).includes('google.com')),
    usesPassword: () => !!(user && (user.providers || ['password']).includes('password')),
    async resetPassword(email) { const a = await ensureAdapter(); await a.resetPassword(email); },
    async signOut() {
      stop(); stopEntitlement();
      if (adapter) await adapter.signOut();
      state = {}; saveState(); user = null; echo.clear();
      setStatus('signedout');
    },
    /** Deletes all synced data and the sign-in. Local data on this device stays. */
    async deleteAccount(password) {
      if (!adapter || !user) throw new Error('Not signed in.');
      await adapter.reauthenticate(password);
      stop(); stopEntitlement();
      await adapter.deleteAllData(user.uid);
      await adapter.deleteUser();
      state = {}; saveState(); user = null; echo.clear();
      setStatus('signedout');
    },
    friendlyError,

    // --- Subscription -------------------------------------------------------------------------
    /** True when sync needs a subscription (paywall on and backend supports it). */
    requiresSubscription: () => paywall(),
    subscription: () => Object.assign({}, sub, { active: !paywall() || (sub.active && sub.activeUntil > Date.now()) }),
    /** True in the Android app, where Google Play purchases are possible. */
    canPurchase: () => !!billing(),
    priceText: () => subConfig().price,
    trialText: () => subConfig().trial || '',
    /** Price from Google Play (formatted in the user's currency), or null. */
    async getOffer() {
      const b = billing(); if (!b) return null;
      try { return await b.getProduct({ productId: subConfig().productId }); } catch (e) { return null; }
    },
    async subscribe() {
      const b = billing();
      if (!b) throw new Error('Subscribe in the Pundo Android app from Google Play.');
      if (!user || !adapter) throw new Error('Sign in first.');
      const p = await b.purchase({ productId: subConfig().productId, accountId: await accountTag(user.uid) });
      if (p && p.state === 'pending') return { pending: true };
      const res = await adapter.checkSubscription([{ purchaseToken: p.purchaseToken, productId: p.productId }]);
      if (res && res.active) onEntitlement({ activeUntil: res.activeUntil, source: res.source, autoRenewing: res.autoRenewing });
      return res;
    },
    restorePurchases: () => refreshSubscription(),
    async manageSubscription() {
      const b = billing();
      if (b && b.manage) return b.manage({ productId: subConfig().productId });
      window.open('https://play.google.com/store/account/subscriptions', '_blank', 'noopener');
    },
  };
})();
