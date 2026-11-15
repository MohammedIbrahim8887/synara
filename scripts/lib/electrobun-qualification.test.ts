import { describe, expect, it } from "vitest";
import { readElectrobunQualification } from "./electrobun-qualification";

const report = { ok: true, platform: "darwin", arch: "arm64", productionParity: false };
const stdout = `SYNARA_ELECTROBUN_QUALIFICATION ${JSON.stringify(report)}\n`;
const input = { stdout, stderr: "", platform: "darwin", arch: "arm64", requireParity: false };

describe("native Electrobun qualification", () => {
  it("distinguishes a successful smoke from full production parity", () => {
    expect(readElectrobunQualification(input)).toEqual(report);
    expect(() => readElectrobunQualification({ ...input, requireParity: true })).toThrow(
      "parity is incomplete",
    );
  });

  it("rejects a successful report followed by a native shutdown timeout", () => {
    expect(() =>
      readElectrobunQualification({
        ...input,
        stderr: "[waitForShutdownComplete] Timed out after 5000ms",
      }),
    ).toThrow("shutdown timeout");
  });

  it("requires exactly one report for the current target", () => {
    expect(() => readElectrobunQualification({ ...input, stdout: "" })).toThrow("exactly one");
    expect(() => readElectrobunQualification({ ...input, stdout: stdout + stdout })).toThrow(
      "exactly one",
    );
    expect(() => readElectrobunQualification({ ...input, platform: "win32" })).toThrow(
      "different target",
    );
  });
});
