# Turning on sync (Firebase project `pundo-app`)

Pundo is already connected to your Firebase project, **pundo-app**:
* `js/firebase-config.js` holds the project settings.
* `android/app/google-services.json` is your Android app file.

Two things must be switched on in the Firebase console before sign-in and sync work. Both are free.

Open <https://console.firebase.google.com> and choose **pundo-app**.

## 1. Turn on email & password sign-in

1. In the left menu, click **Build → Authentication** (or **Security → Authentication**).
2. Click **Get started**.
3. On the **Sign-in method** tab, click **Email/Password**.
4. Turn on the first switch, **Email/Password**. Leave *Email link* off.
5. Click **Save**.

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
2. Go to **Settings & backup → Sync across devices**. Type your email and a password, then tap **Create account**.
3. On a second device, sign in with the same email and password. Your books appear there within a few seconds.

You can see accounts under **Authentication → Users** and data under **Firestore Database → Data → users**. The data is stored as raw records, so it's easier to view in the app.

## Costs

Everything here fits in Firebase's free **Spark** plan until you have about a thousand active users. Nothing is charged unless you upgrade to the pay-as-you-go plan. The ₱100/month subscription will need that plan later, because it uses a small server function. It still includes free monthly quotas.

## Optional, later
* **Web app id:** add a **Web app** under *Project settings → Your apps* and copy its `appId` into `js/firebase-config.js`. This is only needed for Analytics.
* **Google sign-in:** this comes with the next update. It needs the SHA-1 fingerprints of your upload key and of Play App Signing (*Play Console → Setup → App signing*) added to the Android app in Firebase.
