import { describe, expect, it } from "vitest";

import { chromeLaunchArguments } from "./chromeLauncher";
import { normalizePaneUrl, parsePaneInput } from "./paneServer";

describe("pane input", () => {
  it("accepts well-formed pointer, wheel, key and text input with clamped values", () => {
    expect(
      parsePaneInput({
        kind: "mouse",
        type: "mousePressed",
        x: 10,
        y: 20,
        button: "left",
        buttons: 1,
        clickCount: 9,
        modifiers: 99,
      }),
    ).toEqual({
      kind: "mouse",
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      buttons: 1,
      clickCount: 3,
      modifiers: 15,
    });
    expect(parsePaneInput({ kind: "wheel", x: 1, y: 2, deltaY: 1e9 })).toMatchObject({
      deltaY: 10_000,
    });
    expect(
      parsePaneInput({
        kind: "key",
        type: "keyDown",
        key: "a",
        code: "KeyA",
        keyCode: 65,
        text: "a",
        commands: ["selectAll", "evil; drop"],
      }),
    ).toMatchObject({ key: "a", text: "a", commands: ["selectAll"] });
    expect(parsePaneInput({ kind: "text", text: "pasted" })).toEqual({
      kind: "text",
      text: "pasted",
    });
  });

  it("rejects unknown kinds and event types", () => {
    expect(parsePaneInput({ kind: "mouse", type: "dragStart", button: "left" })).toBeNull();
    expect(parsePaneInput({ kind: "key", type: "char", key: "a" })).toBeNull();
    expect(parsePaneInput({ kind: "eval", code: "1" })).toBeNull();
    expect(parsePaneInput("text")).toBeNull();
  });
});

describe("address bar entries", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["localhost:5173/app", "http://localhost:5173/app"],
    ["https://x.test/a?b", "https://x.test/a?b"],
    ["file:///tmp/a.html", "file:///tmp/a.html"],
    ["plate recognition", "https://www.google.com/search?q=plate%20recognition"],
  ])("%s", (input, expected) => {
    expect(normalizePaneUrl(input)).toBe(expected);
  });
});

describe("Chromium launch", () => {
  it("drives Chromium over a private pipe through the network guard", () => {
    const args = chromeLaunchArguments({
      executable: "/chrome",
      profileDirectory: "/home/profile",
      proxyPort: 4321,
      platform: "darwin",
    });
    expect(args).toContain("--remote-debugging-pipe");
    expect(args.some((arg) => arg.startsWith("--remote-debugging-port"))).toBe(false);
    expect(args).toContain("--proxy-server=socks5://127.0.0.1:4321");
    expect(args).toContain("--user-data-dir=/home/profile");
    expect(args).toContain("--use-mock-keychain");
  });
});
