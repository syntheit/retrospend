import { describe, expect, it } from "vitest";
import { sealedPaths, sealedPathsInBody } from "./sealed-paths";

describe("sealedPaths", () => {
	it("names every string that starts with U+0001, never its value", () => {
		const body = {
			result: {
				data: {
					json: [
						{ title: "plain", note: "\u0001k1:AAAA" },
						{ nested: { name: "\u0001k1:BBBB" } },
					],
				},
			},
			count: 2,
		};
		expect(sealedPaths(body)).toEqual([
			"$.result.data.json[0].note",
			"$.result.data.json[1].nested.name",
		]);
	});

	it("ignores U+0001 anywhere but the start, keys, numbers and nulls", () => {
		expect(
			sealedPaths({ "\u0001key": "a", mid: "a\u0001b", n: 1, z: null }),
		).toEqual([]);
	});
});

describe("sealedPathsInBody", () => {
	// A body captured from the dev server (httpBatchStreamLink, `trpc-accept:
	// application/jsonl`): a head line that names the chunks, then one line per
	// chunk. The last line carries a sealed name, as a leak would.
	const jsonl = [
		'{"json":{"0":[[0],[null,0,0]],"1":[[0],[null,0,1]]}}',
		'{"json":[0,0,[[{"result":0}],["result",0,2]]]}',
		'{"json":[2,0,[[{"data":0}],["data",0,3]]]}',
		'{"json":[3,0,[[{"count":0}]]]}',
		'{"json":[1,0,[[{"result":0}],["result",0,4]]]}',
		'{"json":[4,0,[[{"data":0}],["data",0,5]]]}',
		'{"json":[5,0,[[{"avatarUrl":null,"name":"\\u0001k1:AAAAAQ=="}]]]}',
	].join("\n");

	it("reads JSON lines and finds a sealed string nested in a chunk", () => {
		// One JSON.parse of the whole body fails, which is how the guard once
		// swallowed every page tRPC response.
		expect(() => JSON.parse(jsonl)).toThrow();
		expect(sealedPathsInBody(jsonl)).toEqual(["#7$.json[2][0][0].name"]);
		expect(
			sealedPathsInBody(`${jsonl.split("\n").slice(0, 6).join("\n")}\n`),
		).toEqual([]);
	});

	it("reads one JSON value, and an empty body", () => {
		expect(sealedPathsInBody('{"a":"\\u0001x"}')).toEqual(["$.a"]);
		expect(sealedPathsInBody('{"a":"x"}\n')).toEqual([]);
		expect(sealedPathsInBody("  ")).toEqual([]);
	});

	it("throws on a body that is not JSON or JSON lines", () => {
		expect(() => sealedPathsInBody("<html>")).toThrow();
		expect(() => sealedPathsInBody('{"a":1}\nnot json')).toThrow();
	});
});
