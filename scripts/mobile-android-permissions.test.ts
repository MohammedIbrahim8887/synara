import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../apps/mobile/app.json", import.meta.url), "utf8"),
) as {
  expo: { android: { permissions: string[]; blockedPermissions: string[] } };
};

// Chromium's audio routing needs MODIFY_AUDIO_SETTINGS as well as the runtime
// microphone grant. Testing only RECORD_AUDIO leaves getUserMedia broken in WebView.
describe("Android WebView voice permissions", () => {
  it.each(["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"])(
    "ships %s without blocking it",
    (permission) => {
      const fullName = `android.permission.${permission}`;
      expect(
        config.expo.android.permissions.map((value) => value.replace(/^android\.permission\./, "")),
      ).toContain(permission);
      expect(config.expo.android.blockedPermissions).not.toContain(fullName);
      expect(config.expo.android.blockedPermissions).not.toContain(permission);
    },
  );
});
