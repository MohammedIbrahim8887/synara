const PREFIX = "SYNARA_ELECTROBUN_QUALIFICATION ";

export function readElectrobunQualification(input: {
  stdout: string;
  stderr: string;
  platform: string;
  arch: string;
  requireParity: boolean;
}): Record<string, unknown> {
  if (/\[waitForShutdownComplete\].*Timed out/i.test(input.stderr + input.stdout)) {
    throw new Error("Electrobun reported a native shutdown timeout.");
  }
  const reports = input.stdout.split(/\r?\n/).filter((line) => line.startsWith(PREFIX));
  if (reports.length !== 1)
    throw new Error("Native qualification did not emit exactly one report.");
  const report: unknown = JSON.parse(reports[0]!.slice(PREFIX.length));
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Invalid native qualification report.");
  }
  const result = report as Record<string, unknown>;
  if (result.ok !== true || result.platform !== input.platform || result.arch !== input.arch) {
    throw new Error(
      `Native qualification failed or ran for a different target: ${JSON.stringify(result)}`,
    );
  }
  if (input.requireParity && result.productionParity !== true) {
    throw new Error("Electrobun production parity is incomplete. See docs/electrobun.md.");
  }
  return result;
}
