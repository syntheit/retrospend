import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	createFiguresRegistry,
	type FigureDefinition,
	FigureError,
	FigurePass,
	FigureRegistryError,
	figures,
	narrowScope,
	readFigure,
} from "./registry";

type NoDb = null;

const constant = (
	id: string,
	extra: Partial<FigureDefinition<NoDb>> = {},
): FigureDefinition<NoDb> => ({
	id,
	scope: [],
	compute: async () => ({ minor: 1, currency: "ARS" }),
	...extra,
});

/**
 * Drops block and line comments so a commented-out describe does not count.
 * A `//` right after a colon or a quote is kept, so URLs in strings survive.
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Ids that have a `describe("figure <id>", ...)` block in `source` (the convention in registry.ts). */
function testedFigureIds(source: string): string[] {
	const title = /describe\(\s*(["'])figure ([A-Za-z0-9.]+)\1/g;
	return [...stripComments(source).matchAll(title)].map(
		(match) => match[2] ?? "",
	);
}

function allTestSources(): string[] {
	const src = fileURLToPath(new URL("../..", import.meta.url));
	return readdirSync(src, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".test.ts"))
		.map((file) => readFileSync(join(src, file), "utf8"));
}

describe("createFiguresRegistry", () => {
	it("fails when two figures claim one id", () => {
		expect(() =>
			createFiguresRegistry([
				constant("owed.owedToYou"),
				constant("owed.owedToYou"),
			]),
		).toThrow(
			new FigureRegistryError('two figures claim the id "owed.owedToYou"'),
		);
	});

	it("rejects an id that is not dotted camelCase", () => {
		expect(() => createFiguresRegistry([constant("Owed to you")])).toThrow(
			FigureRegistryError,
		);
	});

	it("fails a lookup of an unregistered id", () => {
		expect(() => createFiguresRegistry([]).get("netWorth")).toThrow(
			FigureRegistryError,
		);
	});

	it("collects the figures every preview checks, in order", () => {
		const registry = createFiguresRegistry([
			constant("netWorth", { inEveryPreview: true }),
			constant("spent"),
			constant("accounts.total", { inEveryPreview: true }),
		]);

		expect(registry.ids).toEqual(["netWorth", "spent", "accounts.total"]);
		expect(registry.inEveryPreview).toEqual(["netWorth", "accounts.total"]);
	});
});

describe("narrowScope", () => {
	it("keeps the user and only the declared narrowings", () => {
		expect(
			narrowScope({ userId: "u1", personId: "p1", projectId: "j1" }, [
				"personId",
				"accountId",
			]),
		).toEqual({ userId: "u1", personId: "p1" });
	});
});

describe("readFigure", () => {
	it("passes the narrowed scope and returns one amount as a one-line list", async () => {
		const compute = vi.fn(async () => ({ minor: 350_000, currency: "ARS" }));
		const value = await readFigure(
			constant("balance.withPerson", { scope: ["personId"], compute }),
			null,
			{ userId: "u1", personId: "p1", accountId: "a1" },
		);

		expect(value).toEqual([{ minor: 350_000, currency: "ARS" }]);
		expect(compute).toHaveBeenCalledWith(
			null,
			{ userId: "u1", personId: "p1" },
			expect.any(FigurePass),
		);
	});

	it("passes null through as unavailable", async () => {
		const unavailable = constant("netWorth", { compute: async () => null });
		expect(await readFigure(unavailable, null, { userId: "u1" })).toBeNull();
	});

	it("names the figure when it throws, keeping the cause", async () => {
		const cause = new Error("no rate");
		const broken = constant("netWorth", {
			compute: async () => {
				throw cause;
			},
		});

		const error = await readFigure(broken, null, { userId: "u1" }).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(FigureError);
		expect(error).toMatchObject({ figureId: "netWorth", cause });
	});

	it("returns a per-currency list as given", async () => {
		const lines = [
			{ minor: 350_000, currency: "ARS" },
			{ minor: 2_000, currency: "USD" },
		];
		const both = constant("balance.withPerson", { compute: async () => lines });
		expect(await readFigure(both, null, { userId: "u1" })).toEqual(lines);
	});

	it("sorts currency lines by code, whatever order the query returned", async () => {
		const lines = [
			{ minor: 2_000, currency: "USD" },
			{ minor: 1, currency: "BTC" },
			{ minor: 350_000, currency: "ARS" },
		];
		const mixed = constant("balance.withPerson", {
			compute: async () => lines,
		});
		const reading = await readFigure(mixed, null, { userId: "u1" });
		expect(reading?.map((money) => money.currency)).toEqual([
			"ARS",
			"BTC",
			"USD",
		]);
	});

	it("rejects a list that names a currency twice", async () => {
		const twice = constant("balance.withPerson", {
			compute: async () => [
				{ minor: 1, currency: "ARS" },
				{ minor: 2, currency: "ARS" },
			],
		});
		await expect(readFigure(twice, null, { userId: "u1" })).rejects.toThrow(
			"lists ARS twice",
		);
	});

	it("rejects a float amount", async () => {
		const float = constant("spent", {
			compute: async () => ({ minor: 10.5, currency: "USD" }),
		});
		await expect(readFigure(float, null, { userId: "u1" })).rejects.toThrow(
			FigureError,
		);
	});
});

describe("figures (the product registry)", () => {
	it("finds tests by their literal title", () => {
		// Quotes come from variables so this file's own text never matches the scan.
		const [dq, sq] = ['"', "'"];
		const source = `describe(${dq}figure owed.owedToYou${dq}, () => {});\ndescribe(${sq}figure netWorth${sq}, () => {});`;
		expect(testedFigureIds(source)).toEqual(["owed.owedToYou", "netWorth"]);
	});

	it("ignores a describe that is commented out", () => {
		const [dq, sl] = ['"', "/"];
		const line = `${sl}${sl} describe(${dq}figure spent${dq}, () => {});`;
		const block = `${sl}* describe(${dq}figure netWorth${dq}, () => {}); *${sl}`;
		const url = `const u = ${dq}https:${sl}${sl}x${dq}; describe(${dq}figure owed.youOwe${dq}, () => {});`;
		expect(testedFigureIds([line, block, url].join("\n"))).toEqual([
			"owed.youOwe",
		]);
	});

	// A duplicate id in the product list already fails here: importing ./registry throws.
	it("has a test for every registered figure", () => {
		const tested = new Set(allTestSources().flatMap(testedFigureIds));
		const untested = figures.ids.filter((id) => !tested.has(id));
		expect(untested).toEqual([]);
	});
});
