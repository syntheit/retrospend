// Names and paths shared by the files of scripts/db-owner.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OWNER_ROLE = "retrospend_owner";

/** The project root: /app in the image. */
export const PROJECT_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

/**
 * The text of a file in prisma/bootstrap.
 *
 * @param {string} name
 */
export const bootstrapFile = (name) =>
	readFileSync(join(PROJECT_ROOT, "prisma", "bootstrap", name), "utf8");
