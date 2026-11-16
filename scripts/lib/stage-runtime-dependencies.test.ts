import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { stageRuntimeDependencies } from "./stage-runtime-dependencies";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sona-dependencies-"));
  roots.push(root);
  return root;
}
async function pkg(root: string, data: object) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify(data));
}

it("copies a cyclic production graph and distinct versions without dev dependencies or outside links", async () => {
  const root = await fixture();
  const source = path.join(root, "source");
  const modules = path.join(source, "node_modules");
  await pkg(source, { dependencies: { a: "1", b: "2" }, devDependencies: { secret: "1" } });
  await pkg(path.join(modules, "a"), { name: "a", version: "1", dependencies: { b: "1" } });
  await pkg(path.join(modules, "a/node_modules/b"), {
    name: "b",
    version: "1",
    dependencies: { a: "1" },
  });
  await pkg(path.join(modules, "b"), {
    name: "b",
    version: "2",
    optionalDependencies: { absent: "1" },
  });
  await pkg(path.join(modules, "secret"), { name: "secret", version: "1" });
  const target = path.join(root, "artifact/node_modules");
  const inventory = await stageRuntimeDependencies(source, target);
  expect(inventory).toEqual([
    { name: "a", version: "1" },
    { name: "b", version: "1" },
    { name: "b", version: "2" },
  ]);
  // Deleting the source proves the artifact's links and cyclic graph are self-contained.
  await rm(source, { recursive: true });
  const a = await realpath(path.join(target, "a"));
  expect(a.startsWith(`${await realpath(target)}/`)).toBe(true);
  const nested = JSON.parse(await readFile(path.join(a, "node_modules/b/package.json"), "utf8"));
  expect(nested.version).toBe("1");
  expect(await realpath(path.join(a, "node_modules/b/node_modules/a"))).toBe(a);
  await expect(realpath(path.join(target, "secret"))).rejects.toThrow();
});

it("fails when a required runtime dependency is missing", async () => {
  const root = await fixture();
  await pkg(root, { dependencies: { missing: "1" } });
  await expect(stageRuntimeDependencies(root, path.join(root, "out"))).rejects.toThrow(
    "Missing installed runtime dependency: missing",
  );
});
