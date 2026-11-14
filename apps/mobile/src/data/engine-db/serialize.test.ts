import { sameValue } from "@retrospend/engine";
import { decodeRow, encodeRow, SerializeError } from "./serialize";

// What a Decimal is to the serializer: a class instance with its own value.
class Decimal {
	constructor(private readonly text: string) {}
	toString() {
		return this.text;
	}
}

const back = (v: unknown) => decodeRow(encodeRow(v));

describe("round trip", () => {
	it("keeps strings, numbers, booleans, null and nesting", () => {
		const row = {
			id: "e1",
			amount: "1000.50",
			minor: -250,
			zero: 0,
			flag: false,
			none: null,
			list: ["a", 1, { deep: [true, null] }],
		};
		expect(back(row)).toEqual(row);
	});

	it("keeps Dates, top level and nested, as the same instants", () => {
		const at = new Date("2026-03-05T12:00:00.123Z");
		const row = {
			id: "x",
			at,
			nested: { when: new Date(0), many: [{ d: at }] },
		};
		const read = back(row) as typeof row;
		expect(read.at).toBeInstanceOf(Date);
		expect(read.at.getTime()).toBe(at.getTime());
		expect(read.nested.when.getTime()).toBe(0);
		expect(read.nested.many[0]?.d.getTime()).toBe(at.getTime());
		expect(sameValue(read, row)).toBe(true);
	});

	it("reads a field that was undefined as absent", () => {
		const read = back({ id: "s", a: 1, b: undefined }) as object;
		expect(Object.hasOwn(read, "b")).toBe(false);
		expect(sameValue(read, { id: "s", a: 1 })).toBe(true);
	});

	it("reads text that merely contains the date marker as the text it was", () => {
		const row = { id: "t", note: 'a "$d" in text', nested: { k: "$d" } };
		expect(back(row)).toEqual(row);
	});

	it("stores minus zero as zero", () => {
		expect(Object.is((back({ n: -0 }) as { n: number }).n, 0)).toBe(true);
	});
});

describe("refusals", () => {
	const refused = (v: unknown) =>
		expect(() => encodeRow(v)).toThrow(SerializeError);

	it("refuses an Invalid Date, top level and nested", () => {
		refused({ at: new Date(Number.NaN) });
		refused({ a: [{ b: new Date("nope") }] });
	});

	it("refuses NaN and infinities", () => {
		refused({ n: Number.NaN });
		refused({ n: Number.POSITIVE_INFINITY });
		refused({ n: [Number.NEGATIVE_INFINITY] });
	});

	it("refuses a Decimal and any other class instance", () => {
		refused({ amount: new Decimal("1.5") });
		refused({ m: new Map() });
		refused({ s: new Set() });
		refused({ u: new Uint8Array(2) });
	});

	it("refuses functions, symbols, bigints and undefined array items", () => {
		refused({ f: () => 1 });
		refused({ s: Symbol("x") });
		refused({ b: 1n });
		refused({ list: [1, undefined] });
	});

	it("refuses an object that uses the date marker as a key", () => {
		refused({ $d: "2026-01-01T00:00:00.000Z" });
	});

	it("names the field, never the value", () => {
		try {
			encodeRow({
				amount: "secret-amount",
				nested: { at: new Date(Number.NaN) },
			});
			throw new Error("should have refused");
		} catch (error) {
			expect((error as Error).message).toContain("nested.at");
			expect((error as Error).message).not.toContain("secret-amount");
		}
	});
});

describe("reading text it did not write", () => {
	it("throws on a date marker that is not a date", () => {
		expect(() => decodeRow('{"a":{"$d":"nope"}}')).toThrow(SerializeError);
		expect(() => decodeRow('{"a":{"$d":5}}')).toThrow(SerializeError);
	});

	it("throws on broken JSON", () => {
		expect(() => decodeRow("{not json")).toThrow(SyntaxError);
	});
});
