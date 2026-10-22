// pnpm ui:tokens: regenerate every token output from the DTCG source in this
// folder. Run it after any token change and commit the source and outputs
// together; src/test/uiRules/tokens.test.ts fails while an output is stale.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOutputs } from "./outputs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

for (const { path, content } of await buildOutputs()) {
	const file = join(REPO_ROOT, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
	console.log(`wrote ${path}`);
}
