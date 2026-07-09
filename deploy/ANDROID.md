# Android app — Capacitor shell (WP-14)

`deploy/README.md` is architect-owned; this is a standalone addendum for the one-time,
owner-only steps to get a signed, sideloadable Hello Picnic APK on both phones. Nothing
in here is required for CI/dev/web — the Android project is a thin native shell that
loads the real deployed web app, it ships **no bundled UI code** of its own.

There is **no Android SDK in the CI/sandbox environment** this repo was built in. The
Capacitor "add platform" scaffold (`android/`) was generated and is checked in, but every
step below that needs Android Studio/`gradlew`/a keystore is an owner deploy-time task
that has not been run yet. Treat this file as a script, not a confirmation that it works
— run it once for real and note any deviations here.

## 0. How the shell works

`capacitor.config.ts` sets `server.url` from the `CAP_SERVER_URL` env var at
**sync time** (baked into `android/app/src/main/assets/capacitor.config.json` by
`npx cap sync android`, not read at runtime). The WebView then always loads
`https://<jouw-vps-domein>` directly — there is no offline/bundled copy of the app, so
every web deploy is instantly live on the phone too, and there is nothing to re-publish
to a store for ordinary feature work. This also means the phone needs network access to
use the app at all, same as the PWA.

## 1. Install Android Studio + SDK (once, per machine)

1. Download Android Studio: https://developer.android.com/studio
2. First-run wizard installs the SDK, platform tools and a default emulator image —
   accept the defaults (min/target/compile SDK are pinned in
   `android/variables.gradle`: `minSdkVersion 24`, `targetSdkVersion`/`compileSdkVersion
   36`; the wizard's default SDK Platform 36 covers this).
3. Confirm `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) is set and `adb` is on `PATH` — Android
   Studio's "SDK Manager" dialog shows the install path if you need to set these by hand.

## 2. Point the shell at your deployment

```bash
export CAP_SERVER_URL=https://<jouw-vps-domein>
npm run cap:sync   # = npx cap sync android — copies config + native plugins into android/
```

Re-run `npm run cap:sync` any time `CAP_SERVER_URL` changes or a Capacitor plugin
version bumps. It does **not** need to run for ordinary web-only feature changes.

## 3. Deep links (`https://<domein>/recepten/...` opens the app, not the browser)

1. Edit `android/app/src/main/res/values/strings.xml` — replace the
   `app_domain` placeholder (`REPLACE_WITH_DOMAIN.example.com`) with the real hostname
   (same host as `CAP_SERVER_URL`, without scheme).
2. `AndroidManifest.xml` already declares the App Links intent-filter
   (`android:autoVerify="true"`, scheme `https`, host `@string/app_domain`) — this both
   opens shared recipe links and the deep links embedded in Google Calendar prep-event
   descriptions (`calendarService.publishPlan`, WP-12) directly in the app.
3. Android verifies App Links by fetching
   `https://<jouw-vps-domein>/.well-known/assetlinks.json` and checking it lists this
   app's signing certificate. The file already exists at
   `public/.well-known/assetlinks.json` (served by the Next.js app itself, no extra
   route needed) — after generating the release keystore (step 5), replace
   `REPLACE_WITH_KEYSTORE_SHA256_FINGERPRINT` in that file with the real fingerprint:
   ```bash
   keytool -list -v -keystore hello-picnic-release.keystore -alias hellopicnic | grep 'SHA256:'
   ```
   Deploy the updated `assetlinks.json` to the VPS (it's part of the normal web deploy —
   no separate step) *before* relying on auto-verify; until then, tapping a link falls
   back to Android's normal browser/app chooser sheet instead of opening Hello Picnic
   directly, which is harmless but less slick.
4. Verify on-device once installed: `adb shell pm get-app-links nl.hellopicnic.app`
   should show the domain as `verified`.

## 4. Camera-toestemming (scan flow)

The HelloFresh-kaart scan flow (`src/app/(shell)/meer/scannen`) uses a plain
`<input type="file" capture="environment">` in the web app — not the
`@capacitor/camera` plugin, so there's no extra plugin dependency. Inside a WebView this
still needs two things, both already wired up in this scaffold:

- **`AndroidManifest.xml`**: `<uses-permission android:name="android.permission.CAMERA" />`
  and `<uses-feature android:name="android.hardware.camera" android:required="false" />`.
  Required for the WebView's file-chooser to offer a "take photo" option at all — without
  the manifest permission it silently falls back to file-browsing only.
- **`MainActivity.java`**: requests the `CAMERA` runtime permission on launch
  (Android 6+ requires the *runtime* grant in addition to the manifest declaration, or
  the WebView drops the camera option even though it's declared). This is a one-time
  system prompt the first time the app opens.

No further code is needed — confirm on a real device that "Scan kaarten" → upload tegel
offers "Camera" as an option and that a captured photo round-trips through the existing
upload flow.

## 5. Adaptive icon + splash screen

Source images already exist at `assets/icon.png` (1024×1024, derived from
`public/icons/icon-512-maskable.png`, which already has the maskable safe-zone padding
baked in) and `assets/splash.png` (2732×2732, the non-maskable icon centered on the
brand background `#FAF8F5` per `docs/DESIGN_PRINCIPLES.md` §2). Generate the actual
Android resources from them:

```bash
npx @capacitor/assets generate --android
```

**Deviation / owner follow-up**: this command could not be run in the sandbox this WP
was built in — `@capacitor/assets` needs to download a prebuilt `sharp`/`libvips`
binary from a GitHub release at install time, and this sandbox's network egress policy
blocks that host (403, not a bug — see the CI/sandbox notes, nothing to fix on the app
side). `android/app/src/main/res/**/ic_launcher*.png`, `mipmap-anydpi-v26/*.xml` and
`drawable*/splash.png` are therefore still Capacitor's stock placeholder (a plain green
robot icon and a white splash). Run the command above once on a machine with normal
internet access — it edits the same paths in place — then rebuild.

## 6. Keystore genereren (eenmalig, veilig bewaren)

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore hello-picnic-release.keystore \
  -alias hellopicnic \
  -keyalg RSA -keysize 2048 -validity 10000
```

- Kies een sterk wachtwoord voor zowel de keystore als de key; noteer beide in de
  wachtwoordmanager van het gezin (1Password/Bitwarden), niet in dit repo.
- **Bewaar `hello-picnic-release.keystore` buiten git** — het staat expliciet in
  `.gitignore` (`*.jks`, `*.keystore`, zowel root als `android/.gitignore`) zodat een
  `git add -A` het nooit per ongeluk meeneemt. Zet een kopie in de wachtwoordmanager of
  een versleutelde back-updrive. **Verlies van deze file betekent dat je nooit meer een
  update naar hetzelfde geïnstalleerde app-icoon kunt sideloaden** — Android accepteert
  alleen updates die met dezelfde key ondertekend zijn; het enige alternatief is dan
  verwijderen + opnieuw installeren (lokale app-data gaat verloren, de echte data staat
  toch al server-side).
- Vul `android/keystore.properties` (nieuw, niet in git — voeg toe aan
  `android/.gitignore` als je het aanmaakt) met:
  ```properties
  storeFile=/absolute/path/to/hello-picnic-release.keystore
  storePassword=<keystore-wachtwoord>
  keyAlias=hellopicnic
  keyPassword=<key-wachtwoord>
  ```
  en wijs `android/app/build.gradle`'s `signingConfigs`/`buildTypes.release` ernaar
  (standaard Capacitor/Gradle signing-recept — zie
  https://capacitorjs.com/docs/android/deploying-to-google-play#configuring-gradle-scripts,
  ook van toepassing op sideloading zonder Play Store).

## 7. Signed APK bouwen

```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

## 8. Installeren op beide telefoons

1. Zet "Onbekende bronnen toestaan" aan voor de app waarmee je het APK-bestand opent
   (Instellingen → Apps → Speciale toegang → Onbekende apps installeren) — hoeft maar
   eenmalig per telefoon.
2. Stuur `app-release.apk` naar de telefoon (AirDrop-equivalent/USB/e-mail/Drive) en tik
   erop om te installeren.
3. Herhaal op de tweede telefoon.
4. Open de app, controleer: app-icoon en splash zichtbaar (na stap 5), Vandaag-scherm
   laadt, terugknop navigeert door de app (niet direct de app sluiten), "Scan kaarten"
   biedt een camera-optie, en een gedeelde recept-link opent direct in de app in plaats
   van de browser.

## 9. Updates

Voor een web-only wijziging: niets — de shell laadt altijd de live VPS-URL. Bouw alleen
een nieuw APK opnieuw (stappen 2, 7, 8) als `capacitor.config.ts`, een Capacitor-plugin,
het app-icoon/de splash, of native Android-configuratie verandert. Gebruik dezelfde
keystore (stap 6) — anders weigert Android de update te installeren over de bestaande app.

## Play Store

Buiten scope (`docs/workpackages/WP-14-android-parity-release.md` — "Play Store out of
scope"). Sideloaden via stap 8 is de gekozen distributie voor een tweekoppig
gezinsgebruik.
