# Sona for Android

Expo companion for a running Sona desktop/server. Scan the QR in **Settings → Connections** on your computer. Both devices must be on the same private IPv4 network (Wi-Fi or Ethernet); the computer must stay awake and Sona must stay open. Guest networks that isolate devices will not work.

The companion opens the computer's responsive workspace: projects, provider sessions, chat, approvals, terminals, connectors and settings use the same server and saved data as desktop. Provider credentials stay on the computer. There is no Sona account, paid plan or hosted relay. Provider services can still require their own accounts and subscriptions.

## Install and pair

1. Install the locally built `Sona-0.1.0-android.apk` on Android 7 or later. Allow installation from the app you use to open the APK.
2. Start the updated Sona desktop. Open **Settings → Connections**, turn on local connections and create a pairing code. Permit incoming connections if the computer's firewall asks.
3. Open Sona on Android, allow camera access (and local network access on Android 17+), and scan the computer's code. Confirm the computer address.
4. Revoke a phone in the computer's Connected devices list. Turning local connections off immediately closes its network connections. Re-enable the switch after restarting desktop.

Pairing codes last five minutes and can be used once. A paired phone controls the workspace as its owner, but cannot create more pairing invitations or enable the listener. Only scan codes from your own computer. If Wi-Fi changes the computer's IP address, turn local connections off and on, then scan a new code.

## Development

From the repository root, use the pinned Bun version in `package.json`:

```sh
bun install --frozen-lockfile
cd apps/mobile
bun x expo prebuild --platform android --no-install
bun run android
```

This app includes a local Expo Android module. **Expo Go cannot run it.** Use an emulator/device development build, or install the release APK. Android Studio's SDK and JDK 21 are required. Expo 58 uses Android SDK platform 37.0; install it with Android Studio or `sdkmanager 'platforms;android-37.0'`.

To create a standalone test APK without Metro:

```sh
cd apps/mobile
bun x expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease
```

Output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Expo's generated signing configuration uses a development key; this artifact is for local testing, not a Play Store release. Production distribution requires a privately managed release signing key. Generated Android projects and keys are excluded from Git; the custom module under `modules/sona-connection` is source-controlled.

## Transport and device storage

The opt-in server transport terminates TLS 1.3 on a dedicated LAN port and forwards to the existing loopback server. It enforces authentication before forwarding protected HTTP and WebSocket requests, checks Host/Origin, and retains the existing server session and revocation rules. It never injects the desktop owner's credentials. Its certificate identity and chosen port persist under the existing installation's secrets directory; enabling the listener does not copy data across desktop flavors.

QR codes carry an HTTPS private IPv4 origin, a SHA-256 certificate fingerprint, a short-lived invitation and its expiry. The Android module uses an empty system trust-anchor set and accepts only the exact certificate in the QR. It rejects changed/expired certificates and plaintext traffic. External links open in the system browser. Session cookies remain in private Android WebView storage; the endpoint and certificate fingerprint are saved with Expo SecureStore. Disconnect clears local cookies, web storage and the saved connection; revoke the server session on desktop to invalidate it everywhere.

The sidebar has a Settings button and keeps its content mounted between opens to avoid rebuilding the workspace navigation on each tap. Pairing and disconnect confirmations use Sona’s own dark dialog surface.

Native Android Back navigates workspace history. File attachments use Android's document picker. Desktop-only capabilities (computer control, desktop window management and local desktop dialogs) remain subject to the web client's existing capability checks. OAuth flows that require a desktop callback should be completed on the computer. No iOS app, internet relay, background push notifications or offline workspace copy is included.
