/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { keyId, rowId, TEST_IDS } from "../src/lib/testIds";

// A flow finds controls by id. An id that is not in src/lib/testIds.ts is a
// control the app does not name, so a rename must break `pnpm check` and not
// a nightly run (maestro-plan.md 2.1).
const maestro = join(__dirname, "..", "maestro");

function yamlFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return yamlFiles(path);
		return name.endsWith(".yaml") ? [path] : [];
	});
}

const known = new Set<string>(
	Object.values(TEST_IDS).flatMap((group) => Object.values(group)),
);
const KEYS = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"delete",
	"decimal",
];
for (const key of KEYS) known.add(keyId(key));

/** Every `id: <value>` a flow uses, with the file it is in. */
function idsIn(file: string): string[] {
	return (
		[...readFileSync(file, "utf8").matchAll(/^\s*id:\s*["']?([^"'\s#]+)/gm)]
			.map((match) => match[1] as string)
			// Row ids carry an entity id the flow gets at run time.
			.filter((id) => !id.includes("${"))
	);
}

describe("the Maestro flows", () => {
	const files = yamlFiles(maestro);

	it("exist", () => {
		expect(files.length).toBeGreaterThan(4);
	});

	it.each(files.map((file) => [file.slice(maestro.length + 1), file]))(
		"%s uses only ids the app names",
		(_name, file) => {
			const unknown = idsIn(file as string).filter(
				(id) => !known.has(id) && !id.startsWith(rowId("activity", "")),
			);
			expect(unknown).toEqual([]);
		},
	);
});
