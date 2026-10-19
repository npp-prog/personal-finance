# Sync subscription (3 months free, then ₱25/month): setup

Pundo is free. Cloud sync is a Google Play subscription:

- **App:** shows **Start free trial — 3 months** (or **Subscribe — ₱25 / month** for people who already used their trial) under *Settings & backup → Sync across devices* (`js/sync.js`, `android/.../PundoBillingPlugin.java`).
- **Server:** the `checkSubscription` Cloud Function (`functions/`) verifies each purchase with Google Play, acknowledges it, and writes `entitlements/{uid}`.
- **Database rules:** `firestore.rules` only allow uploads while `entitlements/{uid}.activeUntil` is in the future. Reading and deleting your own data never needs a subscription.
- **Free access:** `functions/free-access.json` lists accounts that sync for free: the Google Play review account and the owner. Edit it and redeploy to change.

Do the steps **in this order**. The current app stops syncing for anyone without a subscription as soon as step 5 is deployed.

## 1. Payments profile (Play Console)

1. Play Console → **Settings → Payments profile** (or **Monetize with Play → Monetization setup**).
2. Create or link a **payments profile** (merchant account) with your name, address and bank account for payouts.

## 2. Upload a build that includes billing

Google only lets you create subscriptions after a build with Play Billing is uploaded.

1. Download the newest **pundo-release-aab** from GitHub **Actions**.
2. Upload it to **Testing → Closed testing → Create new release**. You can roll it out now: until step 5, sync keeps working as before for everyone.

## 3. Create the subscription (Play Console)

1. **Monetize with Play → Products → Subscriptions → Create subscription**.
2. **Product ID:** `pundo_sync` (exactly this, it can't be changed later). **Name:** `Pundo Cloud Sync`.
3. **Add base plan:**
   - **Base plan ID:** `monthly`
   - **Type:** Auto-renewing
   - **Billing period:** 1 month
   - **Grace period:** leave the default
   - **Price:** click **Set prices**, choose **Philippines → PHP 25.00**, and let Google convert other countries. You can also type an amount for each country.
4. **Save**, then **Activate** the base plan.
5. **Add the 3-month free trial.** On the subscription page click **Add offer**:
   - **Base plan:** `monthly`
   - **Offer ID:** `free-trial-3m`
   - **Eligibility:** **New customer acquisition → Never had this subscription** (one trial per Google account)
   - **Phases → Add phase → Free trial**, duration **3 months**
   - **Save**, then **Activate** the offer.

   The app finds the trial automatically. Google only shows it to people who haven't had it yet, and everyone else sees the plain ₱25/month.
6. **Testers who should not be charged:** **Settings → License testing** → add their Gmail addresses. Their purchases are free test purchases that renew every few minutes and stop after six renewals.

## 4. Let the server check purchases

1. **Upgrade Firebase to Blaze** (pay as you go). Cloud Functions require it.
   1. Firebase console → **pundo-app** → bottom-left **Upgrade** → **Blaze**.
   2. Add a card.
   3. Set a **budget alert**, e.g. ₱100.

   At Pundo's size this stays inside the free quota (about ₱0 a month).
2. **Turn on the Google Play Developer API:**
   1. Open https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com?project=pundo-app
   2. Click **Enable**.
3. **Give the server access in Play Console:**
   1. Go to **Users and permissions → Invite new users**.
   2. **Email:** `942596972707-compute@developer.gserviceaccount.com` (the Cloud Functions service account).
   3. **App permissions → Add app → Pundo**, and tick:
      - **View financial data, orders and cancellation survey responses**
      - **Manage orders and subscriptions**
   4. **Invite user**.

   This can take up to 24 hours to start working.

## 5. Deploy the server and rules (Google Cloud Shell, in the browser)

1. Open https://shell.cloud.google.com/?show=terminal, signed in with the Google account that owns Firebase.
2. Get the code:
   ```
   git clone https://github.com/npp-prog/personal-finance.git
   cd personal-finance
   git checkout claude/lucid-babbage-0a0yxl
   ```
   If the repository is **private**, the clone asks for a username and password. Enter your GitHub username, and as the password a token from https://github.com/settings/tokens (**Generate new token (classic)**, tick **repo**).
3. Install and deploy:
   ```
   cd functions && npm install && cd ..
   npx firebase-tools login --no-localhost
   npx firebase-tools deploy --only functions,firestore:rules --project pundo-app
   ```
   The login prints a link: open it, allow access, and paste the code back. The first deploy takes a few minutes and may ask to enable APIs; answer **Y**.
4. When it finishes, you'll see `checkSubscription(asia-southeast1)` and `playNotifications(asia-southeast1)` listed as deployed.

## 6. (Optional) Instant renewals and cancellations

Without this, the app re-checks Google Play whenever access runs out, so renewals still work. With it, cancellations and refunds update right away.

1. Open https://console.cloud.google.com/cloudpubsub/topic/list?project=pundo-app → topic **play-billing** (created by the deploy) → **Permissions** → **Add principal**:
   - `google-play-developer-notifications@system.gserviceaccount.com`
   - role **Pub/Sub Publisher**
2. Play Console → **Monetize with Play → Monetization setup → Real-time developer notifications**:
   - **Topic name:** `projects/pundo-app/topics/play-billing`
   - Click **Send test notification**, then **Save**.

## 7. Test

1. On a phone with a **license tester** Google account, install the closed-testing build.
2. Sign in to Pundo with a test account. It should say **Sync paused — needs a subscription**.
3. Tap **Start free trial — 3 months**. Google Play shows the trial and a test card; confirm. (For license testers, trials and renewals are shortened to minutes.)
4. The card changes to **Sync subscription active** and the books upload.
5. Sign in with the same account on another device or a browser. It syncs without paying again.
6. The review account `pundo.review@gmail.com` and the owner's Google account show **Cloud sync is included free**.

## Changing the price later

Change it in Play Console (subscription → base plan → prices; the trial is the offer). Also update `"price"` and `"trial"` in `js/firebase-config.js`: they're only text shown before Google Play's real offer loads and in the signed-out pitch. Raising the price later needs existing subscribers to accept the increase (Google emails them).

## Play Console forms to update

- **Data safety:** add **Financial info → Purchase history** (collected, not shared, app functionality). See PLAYSTORE.md.
- **Sign in details:** the review account already has free sync, so the "full access including paid content" checkbox stays true.
