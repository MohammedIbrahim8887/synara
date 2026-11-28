import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, stat, symlink } from "node:fs/promises";
import path from "node:path";

interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** Copy the installed, patched production graph, preserving distinct dependency versions.
 * All resulting links stay inside the artifact. Workspace/dev dependencies are not shipped.
 */
export async function stageRuntimeDependencies(
  packageRoot: string,
  destination: string,
  /** Extra top-level packages resolved from another workspace, sharing one store. */
  extraTopLevel: ReadonlyArray<{ readonly from: string; readonly names: readonly string[] }> = [],
) {
  const visited = new Map<string, string>();
  const inventory: { name: string; version: string }[] = [];
  async function resolvePackage(name: string, from: string): Promise<string | undefined> {
    let current = from;
    for (;;) {
      const candidate = path.join(current, "node_modules", name);
      try {
        if ((await stat(path.join(candidate, "package.json"))).isFile()) return realpath(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
  async function link(name: string, from: string, targetModules: string, optional: boolean) {
    const source = await resolvePackage(name, from);
    if (!source) {
      if (optional) return;
      throw new Error(`Missing installed runtime dependency: ${name}`);
    }
    let target = visited.get(source);
    if (!target) {
      const id = createHash("sha256").update(source).digest("hex").slice(0, 16);
      target = path.join(destination, ".store", id, "node_modules", name);
      visited.set(source, target);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, {
        recursive: true,
        dereference: true,
        filter: (file) => !path.relative(source, file).split(path.sep).includes("node_modules"),
      });
      const manifest = JSON.parse(
        await readFile(path.join(source, "package.json"), "utf8"),
      ) as Manifest;
      inventory.push({ name: manifest.name ?? name, version: manifest.version ?? "unknown" });
      await dependencies(source, manifest, path.join(target, "node_modules"));
    }
    const linkPath = path.join(targetModules, name);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(path.relative(path.dirname(linkPath), target), linkPath);
  }
  async function dependencies(source: string, manifest: Manifest, targetModules: string) {
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    for (const name of names) {
      const optional =
        name in (manifest.optionalDependencies ?? {}) ||
        (!manifest.dependencies?.[name] &&
          manifest.peerDependenciesMeta?.[name]?.optional === true);
      await link(name, source, targetModules, optional);
    }
  }
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as Manifest;
  await dependencies(packageRoot, manifest, destination);
  for (const extra of extraTopLevel) {
    for (const name of extra.names) {
      const exists = await lstat(path.join(destination, name)).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (!exists) await link(name, extra.from, destination, false);
    }
  }
  return inventory.toSorted((a, b) => a.name.localeCompare(b.name));
}
