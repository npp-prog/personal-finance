/*
 * Firebase project settings for cloud sync (project: pundo-app).
 *
 * Set to null to switch sync off (Pundo then works fully offline).
 * These values are not secret: access to data is protected by the security rules in
 * firestore.rules (each user can only read and write their own books).
 * Taken from android/app/google-services.json. If you later add a Web app in the Firebase
 * console you may replace appId with the web app's id; sign-in and sync work either way.
 */
window.PUNDO_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyCP7F4BIL9y6-wTfhlY2iXfmlNeiY8yZO4",
  "authDomain": "pundo-app.firebaseapp.com",
  "projectId": "pundo-app",
  "storageBucket": "pundo-app.firebasestorage.app",
  "messagingSenderId": "942596972707",
  "appId": "1:942596972707:android:685a1018b4d3424583df16"
};

/*
 * Cloud sync is a paid add-on (Google Play subscription). The rest of Pundo is free.
 * required: false switches the paywall off (everyone who signs in can sync; firestore.rules must
 * then also allow it). productId must match the subscription created in Play Console.
 * price and trial are only display text for before Google Play's real offer loads (and for the
 * signed-out pitch); what users pay is set in Play Console.
 */
window.PUNDO_SUBSCRIPTION = {
  "required": true,
  "productId": "pundo_sync",
  "price": "₱25",
  "trial": "3 months",
  "functionsRegion": "asia-southeast1"
};
