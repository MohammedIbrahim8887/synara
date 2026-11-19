import { describe, expect, it } from "vitest";

import { keyInput } from "./SonaBrowserStreamSurface";

const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({
    code: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    location: 0,
    repeat: false,
    ...init,
  }) as KeyboardEvent;

describe("Sona browser key mapping", () => {
  it("sends printable keys with text and Enter as a carriage return", () => {
    expect(keyInput(key({ key: "a", code: "KeyA", keyCode: 65 }), "down", true)).toMatchObject({
      type: "keyDown",
      text: "a",
    });
    expect(keyInput(key({ key: "Enter", keyCode: 13 }), "down", true)).toMatchObject({
      type: "keyDown",
      text: "\r",
    });
    expect(keyInput(key({ key: "a" }), "up", true)).toEqual(
      expect.objectContaining({ type: "keyUp" }),
    );
    expect(keyInput(key({ key: "a" }), "up", true)).not.toHaveProperty("text");
  });

  it("sends non-text keys raw and maps platform editing shortcuts", () => {
    expect(keyInput(key({ key: "Backspace", keyCode: 8 }), "down", true).type).toBe("rawKeyDown");
    expect(keyInput(key({ key: "a", metaKey: true }), "down", true)).toMatchObject({
      type: "rawKeyDown",
      commands: ["selectAll"],
      modifiers: 4,
    });
    expect(
      keyInput(key({ key: "z", ctrlKey: true, shiftKey: true }), "down", false).commands,
    ).toEqual(["redo"]);
    expect(keyInput(key({ key: "a", ctrlKey: true }), "down", true).commands).toBeUndefined();
  });
});
