import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Where a write goes is chosen in one place, `transportFor` (src/data/transport.ts).
// The type already makes every caller pass a transport; this walks the source
// tree (not a list of callers) so a new file that builds the API transport
// itself, or sends without asking `transportFor`, fails here.

const SRC = join(__dirname, "..", "src");

function* sources(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* sources(path);
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
			yield path;
	}
}

const text = new Map(
	[...sources(SRC)].map((p) => [relative(SRC, p), readFileSync(p, "utf8")]),
);
const withText = (pattern: RegExp) =>
	[...text].filter(([, body]) => pattern.test(body)).map(([name]) => name);

describe("one owner of the transport", () => {
	it("only transport.ts picks API v1; send.ts defines it", () => {
		expect(withText(/\bapiTransport\b/).sort()).toEqual([
			"data/transport.ts",
			"features/entry/send.ts",
		]);
	});

	it("every file that saves, flushes or undoes outside the queue asks transportFor", () => {
		const senders = withText(
			/\b(flushEntries|saveEntry|undoSaved|undoWith)\(/,
		).filter((name) => !/^features\/entry\/(queue|send)\.ts$/.test(name));
		expect(senders.length).toBeGreaterThan(0);
		expect(
			senders.filter((n) => !/\btransportFor\(/.test(text.get(n) ?? "")),
		).toEqual([]);
	});
});
