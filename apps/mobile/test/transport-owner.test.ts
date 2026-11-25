import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Where a write goes is chosen in one place, `transportFor` (src/data/transport.ts).
// The type already makes every caller pass a transport; this walks the whole
// app (src, the expo-router screens in app, any root added later), not a list
// of callers, so a new file that builds the API transport itself, or sends
// without asking `transportFor`, fails here.

const ROOT = join(__dirname, "..");
// What is not bundled into the app, by path from the app root: dependencies
// (at any depth), then top-level folders only, so a folder of that name inside
// src or app is still read. Native projects of the local modules too.
const NOT_BUNDLED = new Set([
	"test",
	"plugins",
	"scripts",
	"maestro",
	"fastlane",
	"locales",
	"ios",
	"android",
]);
const skipped = (name: string, rel: string) =>
	name === "node_modules" ||
	name.startsWith(".") ||
	NOT_BUNDLED.has(rel) ||
	/^modules\/[^/]+\/(ios|android)$/.test(rel);

function* sources(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!skipped(entry.name, relative(ROOT, path))) yield* sources(path);
		} else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
			yield path;
	}
}

const text = new Map(
	[...sources(ROOT)].map((p) => [relative(ROOT, p), readFileSync(p, "utf8")]),
);
const withText = (pattern: RegExp) =>
	[...text].filter(([, body]) => pattern.test(body)).map(([name]) => name);

describe("one owner of the transport", () => {
	it("only transport.ts picks API v1; send.ts defines it", () => {
		expect(withText(/\bapiTransport\b/).sort()).toEqual([
			"src/data/transport.ts",
			"src/features/entry/send.ts",
		]);
	});

	it("every file that saves, flushes or undoes outside the queue asks transportFor", () => {
		const senders = withText(
			/\b(flushEntries|saveEntry|undoSaved|undoWith)\(/,
		).filter((name) => !/^src\/features\/entry\/(queue|send)\.ts$/.test(name));
		expect(senders.length).toBeGreaterThan(0);
		expect(
			senders.filter((n) => !/\btransportFor\(/.test(text.get(n) ?? "")),
		).toEqual([]);
	});
});
