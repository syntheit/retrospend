import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This folder (src/test/uiRules). */
export const HERE = fileURLToPath(new URL(".", import.meta.url));
/** The repository root. Every path in the rules is relative to it. */
export const REPO_ROOT = join(HERE, "..", "..", "..");
