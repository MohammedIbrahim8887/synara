import { describe, expect, it } from "vitest";
import { isAndroidAppUserAgent } from "./androidApp";

const chromeAndroid =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36";

describe("isAndroidAppUserAgent", () => {
  it("detects the token the Android app appends", () => {
    expect(isAndroidAppUserAgent(`${chromeAndroid} SonaAndroid/0.1.0`)).toBe(true);
  });

  it("ignores ordinary mobile and desktop browsers", () => {
    expect(isAndroidAppUserAgent(chromeAndroid)).toBe(false);
    expect(
      isAndroidAppUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("requires the token as its own product, not a substring", () => {
    expect(isAndroidAppUserAgent(`${chromeAndroid} NotSonaAndroid/1.0`)).toBe(false);
    expect(isAndroidAppUserAgent(`${chromeAndroid} SonaAndroid`)).toBe(false);
  });
});
