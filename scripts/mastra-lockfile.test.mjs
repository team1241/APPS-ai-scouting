import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const appRequire = createRequire(new URL("../apps/mastra/package.json", import.meta.url));
const cliRequire = createRequire(appRequire.resolve("mastra"));
const deployerPath = cliRequire.resolve("@mastra/deployer");
const { parse, parseAllDocuments, stringify } = createRequire(deployerPath)("yaml");
const directory = dirname(deployerPath);
let source;
if (process.env.MASTRA_DEPLOYER_SOURCE)
  source = await readFile(process.env.MASTRA_DEPLOYER_SOURCE, "utf8");
else
  for (const name of await readdir(directory)) {
    if (!name.startsWith("services-") || !name.endsWith(".js")) continue;
    const candidate = await readFile(join(directory, name), "utf8");
    if (candidate.includes("async function dropPnpmImporterDependencies(")) {
      source = candidate;
      break;
    }
  }
assert.ok(source, "Cannot locate Mastra lockfile helper; review patch after upgrades");
const start = source.indexOf("async function dropPnpmImporterDependencies(");
const end = source.indexOf("\nvar Deps =", start);
assert.ok(start >= 0 && end > start);
// Exercise the installed dependency's private helper, not a duplicate implementation.
const helper = new Function(
  "fsPromises",
  "parse",
  "parseAllDocuments",
  "stringify",
  `${source.slice(start, end)}; return dropPnpmImporterDependencies;`,
)({ readFile, writeFile }, parse, parseAllDocuments, stringify);
const dependency = "@example/shared";
const importer = {
  dependencies: {
    [dependency]: { specifier: "workspace:*", version: "link:../shared" },
    retained: { version: "1.0.0" },
  },
};
for (const multi of [false, true])
  test(`preserves ${multi ? "pnpm 12 multi-document" : "single-document"} lockfiles`, async () => {
    const folder = await mkdtemp(join(tmpdir(), "mastra-lockfile-"));
    const file = join(folder, "pnpm-lock.yaml");
    const lock = {
      lockfileVersion: "9.0",
      importers: { ".": structuredClone(importer), "apps/agent": structuredClone(importer) },
      packages: { retained: { resolution: { integrity: "fixture" } } },
    };
    const header = { lockfileVersion: "12.0", catalogs: { preserved: true } };
    try {
      await writeFile(file, (multi ? `${stringify(header)}\n---\n` : "") + stringify(lock));
      await helper(file, [dependency]);
      const documents = parseAllDocuments(await readFile(file, "utf8"));
      assert.ok(documents.every((doc) => doc.errors.length === 0));
      const values = documents.map((doc) => doc.toJS());
      assert.equal(values.length, multi ? 2 : 1);
      if (multi) assert.deepEqual(values[0], header);
      const expected = structuredClone(lock);
      for (const value of Object.values(expected.importers)) delete value.dependencies[dependency];
      assert.deepEqual(values.at(-1), expected);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
