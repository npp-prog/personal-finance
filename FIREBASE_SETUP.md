# Turning on sync (Firebase project `pundo-app`)

Pundo is already connected to your Firebase project, **pundo-app**:
* `js/firebase-config.js` holds the project settings.
* `android/app/google-services.json` is your Android app file.

Two things must be switched on in the Firebase console before sign-in and sync work. Both are free.

Open <https://console.firebase.google.com> and choose **pundo-app**.

## 1. Turn on sign-in: Google, and email & password

1. In the left menu, click **Build → Authentication** (or **Security → Authentication**), then **Get started**.
2. Turn on **Google**:
   1. On the **Sign-in method** tab, click **Add new provider → Google**.
   2. Turn on **Enable**.
   3. **Public-facing name:** type `Pundo`.
   4. **Support email:** choose your email.
   5. Click **Save**.
3. Turn on **Email/Password**:
   1. Click **Add new provider → Email/Password**.
   2. Turn on the first switch. Leave *Email link* off.
   3. Click **Save**.

### 1b. Let the Android app use Google sign-in (SHA-1 fingerprints)

Google sign-in in the Android app only works for app copies signed with a key that Firebase knows about.

1. **Copy the two SHA-1 values from Play Console:**
   1. In Play Console, open **Pundo → Test and release → App integrity → App signing**. (In some versions it's *Setup → App signing*.)
   2. Copy the **SHA-1 certificate fingerprint** from both boxes:
      * **App signing key certificate**: used for copies installed from Google Play.
      * **Upload key certificate**: used for the *pundo-release-apk* you install directly.
2. **Add them to Firebase:**
   1. In Firebase, open **Project settings** (the gear icon) → **Your apps** → the Android app `org.mgocandoniaccounting.pundo`.
   2. Click **Add fingerprint**, paste the first SHA-1, and save.
   3. Repeat for the second SHA-1.
3. **Send the updated file:** on the same page, click **google-services.json** to download the updated file, and send it to me (or replace `android/app/google-services.json`). The new file includes the sign-in client that Google sign-in needs.

The **pundo-debug-apk** test build is signed with a temporary key, so Google sign-in won't work in it. Use **pundo-release-apk** (built once your upload key is set up) or install from Google Play's testing track. Email & password sign-in works in every build.

**Web version:** Google sign-in works on `localhost` and `pundo-app.firebaseapp.com`. If you host the web version elsewhere, for example on GitHub Pages, add that domain under **Authentication → Settings → Authorized domains**.

## 2. Create the database and lock it down

1. In the left menu, click **Build → Firestore Database**, then **Create database**.
2. **Edition:** if asked, choose **Standard**.
3. **Database ID:** leave it as `(default)`.
4. **Location:** choose **asia-southeast1 (Singapore)**, the closest to the Philippines.
   - ⚠️ The location can't be changed later.
5. **Security rules:** choose **Start in production mode**, then **Create**.
6. When the database is ready, open the **Rules** tab and delete everything in the editor.
7. Paste the contents of [`firestore.rules`](firestore.rules) from this repository, shown below:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

8. Click **Publish**.

These rules mean each signed-in person can read and write only their own books. Nobody, including other users, can see anyone else's data.

## 3. Try it

1. Install the latest **pundo-debug-apk**, or open the web version.
2. Go to **Settings & backup → Sync across devices**. Tap **Continue with Google**, or type your email and a password and tap **Create account**.
3. On a second device, sign in with the same email and password. Your books appear there within a few seconds.

You can see accounts under **Authentication → Users** and data under **Firestore Database → Data → users**. The data is stored as raw records, so it's easier to view in the app.

## Costs

Everything here fits in Firebase's free **Spark** plan until you have about a thousand active users. Nothing is charged unless you upgrade to the pay-as-you-go plan. The ₱100/month subscription will need that plan later, because it uses a small server function. It still includes free monthly quotas.

## Optional, later
* **Web app id:** add a **Web app** under *Project settings → Your apps* and copy its `appId` into `js/firebase-config.js`. This is only needed for Analytics.
