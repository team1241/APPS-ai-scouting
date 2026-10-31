import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { db } from "./db.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
try {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs, path,
      migrationFolder: fileURLToPath(new URL("./migrations/", import.meta.url)),
    }),
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) console.log(`${result.migrationName}: ${result.status}`);
  if (error) throw error;
} finally {
  await db.destroy();
}
