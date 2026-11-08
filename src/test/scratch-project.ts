/**
 * A scratch Prisma project directory for tests that need a migration history
 * other than the repository's: an older release (some of the real migrations),
 * or a migration of their own (one that fails, or one that needs CREATE on the
 * database). `prisma migrate deploy` only knows "all of the migrations in the
 * project", so the project links the schema, node_modules and the chosen real
 * migrations, and writes the extra ones itself. Pass `dir` as `root` to
 * migrateWithRecovery and prepare (scripts/db-owner).
 */
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ScratchProject = {
	dir: string;
	/** Replaces the SQL of an extra migration (a fixed version of a failed one). */
	writeMigration: (name: string, sql: string) => void;
	cleanup: () => void;
};

export function makeScratchProject(options: {
	/** Link the real migrations that sort before this name. None when omitted. */
	realMigrationsBefore?: string;
	/** Migrations written into the project, after the real ones. */
	extra?: { name: string; sql: string }[];
}): ScratchProject {
	const root = process.cwd();
	const dir = mkdtempSync(join(tmpdir(), "retrospend-scratch-project-"));
	const migrations = join(dir, "prisma", "migrations");
	try {
		mkdirSync(migrations, { recursive: true });
		symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
		writeFileSync(
			join(dir, "prisma.config.ts"),
			readFileSync(join(root, "prisma.config.ts")),
		);
		symlinkSync(
			join(root, "prisma", "schema.prisma"),
			join(dir, "prisma", "schema.prisma"),
		);
		const real = join(root, "prisma", "migrations");
		writeFileSync(
			join(migrations, "migration_lock.toml"),
			readFileSync(join(real, "migration_lock.toml")),
		);
		const before = options.realMigrationsBefore;
		if (before) {
			for (const name of readdirSync(real).sort()) {
				if (name >= before || name.endsWith(".toml")) continue;
				symlinkSync(join(real, name), join(migrations, name));
			}
		}
		for (const { name, sql } of options.extra ?? []) {
			mkdirSync(join(migrations, name), { recursive: true });
			writeFileSync(join(migrations, name, "migration.sql"), sql);
		}
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	return {
		dir,
		writeMigration: (name, sql) => {
			mkdirSync(join(migrations, name), { recursive: true });
			writeFileSync(join(migrations, name, "migration.sql"), sql);
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}
