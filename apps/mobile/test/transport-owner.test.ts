import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Where a write goes is chosen in one place, `transportFor` (src/data/transport.ts).
// The type already makes every caller pass a transport; this walks the whole
// app (src, the expo-router screens in app, any root added later), not a list
// of callers, so a new file that builds the API transport itself, or sends
// without asking `transportFor`, fails here.

const ROOT = join(__dirname, "..");
// What is not bundled into the app: dependencies, tests, build plugins and
// scripts, store and e2e assets, native projects.
const NOT_BUNDLED = new Set([
	"node_modules",
	"test",
	"plugins",
	"scripts",
	"maestro",
	"fastlane",
	"locales",
	"ios",
	"android",
]);

function* sources(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!NOT_BUNDLED.has(entry.name) && !entry.name.startsWith("."))
				yield* sources(path);
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
