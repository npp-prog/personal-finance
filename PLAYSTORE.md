# Publishing Pundo on Google Play

The Android app is this same web app, packaged with [Capacitor](https://capacitorjs.com).
GitHub Actions builds it for you, so you don't need Android Studio.

| What | Where |
|---|---|
| Android project | `android/` |
| App ID (package name) | `org.mgocandoniaccounting.pundo` in `capacitor.config.json` and `android/app/build.gradle` |
| Build workflow | `.github/workflows/android.yml` |
| Store texts & graphics | `store/` |
| Privacy policy | `privacy.html` |

> **Decide the App ID now.** Google Play never lets you change it after the first upload.
> To use a different one, change it in `capacitor.config.json` and in `android/app/build.gradle`
> (`namespace` and `applicationId`), and move the Java folder
> `android/app/src/main/java/org/mgocandoniaccounting/pundo` to match.

---

## 1. Test the app on your phone or tablet (no signing needed)

1. On GitHub, open **Actions → Android build**. It runs on every push; you can also click **Run workflow**.
2. When it finishes (about 5 minutes), open the run and download the **pundo-debug-apk** artifact.
3. Unzip it, copy the `.apk` to your Android device and open it.
4. Allow "Install unknown apps" for your file manager when Android asks.

This test build is for you only. Google Play needs the signed build from step 2.

## 2. Create your upload key (once)

Google Play only accepts apps signed with your private **upload key**.

You need the same key for every future update, so **keep the key file and its password safe.** Save a copy on a USB drive or in your Google Drive.

### On Windows (Command Prompt)

Open **Command Prompt** (Start → type `cmd`). Type or paste each command below **as one line**, then press Enter.

**1. Go to your Documents folder:**

```
cd %USERPROFILE%\Documents
```

**2. Create the key.** It asks for a password (at least 6 characters; nothing appears while you type), your name, your organisation and so on. Type `yes` at the end.

```
keytool -genkeypair -v -keystore pundo-upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

**3. Turn the key file into text for GitHub:**

```
certutil -encodehex -f pundo-upload.keystore pundo-upload.txt 0x40000001
```

**4. Open the text:**

```
notepad pundo-upload.txt
```

Press **Ctrl+A**, then **Ctrl+C**, to copy all of it.

### On macOS / Linux (Terminal)

```bash
keytool -genkeypair -v -keystore pundo-upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -i pundo-upload.keystore | tr -d '\n' > pundo-upload.txt
```

### Add the key to GitHub

In the GitHub repository, open **Settings → Secrets and variables → Actions**. Click **New repository secret** four times:

| Name | Secret |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | paste the text you copied from `pundo-upload.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the password you typed in step 2 |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the same password again |

Never upload `pundo-upload.keystore` itself to the repository; `.gitignore` already blocks it.

## 3. Build the Play Store bundle

1. Go to **Actions → Android build → Run workflow**.
2. Optionally type a version name, e.g. `1.0.0`.
3. Download the **pundo-release-aab** artifact. It contains the `.aab` file you upload to Google Play.

Every run gets a higher version code automatically, which Play requires for each update.

## 4. Publish the privacy policy

Google Play needs a public link to a privacy policy.

1. Open `privacy.html` and replace `YOUR-EMAIL@example.com` with your support email.
2. Publish it using either option:
   - **GitHub Pages:**
     1. Go to **Settings → Pages → Deploy from a branch**, and choose this branch and `/ (root)`.
     2. Your link will be `https://<your-github-username>.github.io/personal-finance/privacy.html`.
     3. GitHub Pages on a private repository needs a paid GitHub plan.
   - **Google Sites:** paste the same text into a free Google Sites page and use its link.

As a bonus, GitHub Pages also hosts the web version of the app at `.../personal-finance/`.

## 5. Set up Google Play Console

1. **Developer account:** sign up at <https://play.google.com/console>. It costs a one-time USD 25, and Google verifies your identity.
2. **Create app:** name *Pundo*, language English, type *App*, *Free*.
3. **App content** (left menu → *Policy and programs → App content*):

   | Section | What to enter |
   |---|---|
   | Privacy policy | your link from step 4 |
   | Ads | No ads |
   | App access | All functionality is available without special access |
   | Content rating | Complete the questionnaire. It's a utility with no user content, which normally rates *Everyone* |
   | Target audience | 18 and over |
   | Data safety | No data collected, no data shared. Everything is stored on the device; there are no servers or analytics. Android's own backup to the user's Google account doesn't count as collection by you. You may tick *"Data is backed up with Android backup"* where the form offers it |
   | Financial features | A personal finance tracking and budgeting tool only. No loans, payments, banking or crypto exchange |
   | Government apps | No |

4. **Store listing:** copy the texts from `store/listing.md`, and upload the icon, feature graphic and screenshots from `store/`.
5. **First release:**
   1. Go to **Testing → Internal testing → Create new release**.
   2. Accept **Play App Signing**: Google keeps the final app-signing key, and your upload key just proves the uploads are yours.
   3. Upload the `.aab` file, add release notes, then save and roll out.
   4. Add your own Google account as a tester and install the app from the opt-in link.
6. **Going public:**
   1. **New personal developer accounts:** Google currently requires a **closed test with at least 12 testers for 14 days in a row** before you can apply for production. Create the closed test under **Testing → Closed testing** and invite the testers.
   2. Once the 14 days are up, apply for production access in the Dashboard, then **promote the release to Production**.
   3. Google's review usually takes a few days.

## 6. Releasing updates

1. Push your changes to GitHub.
2. Run **Android build** with a new version name, or push a tag like `v1.0.1`.
3. Upload the new `.aab` in Play Console (**Production → Create new release**).

## Building locally instead (optional)

You need Node 22+, Java 21 and Android Studio:

```bash
npm ci
npm run android:sync    # copies the web app into android/
npm run android:open    # opens Android Studio → Build → Generate Signed App Bundle
```

## How the Android app differs from the web version

| Feature | In the Android app |
|---|---|
| Back button | Closes an open dialog or menu, goes back a page, and exits from the Dashboard |
| Export backup, Export CSV | Open Android's share sheet, so you can save to Files or Drive, or email the file |
| Print / PDF | Shares the report as a page. Open it in Chrome, which offers to print or **Save as PDF** |
| Data | Stored on the device inside the app, plus an automatic backup copy that Android saves to the user's Google account and restores on a new phone. **Back up now** gives you a file to keep yourself |
