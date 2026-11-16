import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PairingQrCode } from "./PairingQrCode";

it("keeps the pairing tile square and its mark centred at desktop and narrow widths", async () => {
  const screen = await render(
    <div style={{ width: "100%" }}>
      <PairingQrCode value="sona-pairing-test" label="Pair this device" pixelSize={256} />
    </div>,
  );
  try {
    for (const width of [1280, 260]) {
      await page.viewport(width, 700);
      const tile = document.querySelector('[aria-label="Pair this device"]')!;
      const bounds = tile.getBoundingClientRect();
      const qr = tile.querySelector("svg")!.getBoundingClientRect();
      const mark = tile.querySelector("span svg")!.getBoundingClientRect();
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
      expect(Math.abs(qr.x + qr.width / 2 - mark.x - mark.width / 2)).toBeLessThan(1);
      expect(Math.abs(qr.y + qr.height / 2 - mark.y - mark.height / 2)).toBeLessThan(1);
      expect(bounds.right).toBeLessThanOrEqual(width);
    }
  } finally {
    await screen.unmount();
  }
});
