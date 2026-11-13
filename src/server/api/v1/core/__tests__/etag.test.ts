import { describe, expect, it } from "vitest";
import { ifNoneMatchHits, notModifiedFor } from "../etag";

const TAG = '"abc"';
const reply = (init: ResponseInit = {}, tag: string | null = TAG) =>
	new Response('{"x":1}', {
		status: 200,
		...init,
		headers: tag === null ? {} : { etag: tag },
	});
const get = (inm?: string, method = "GET") =>
	new Request("http://localhost/api/v1/x", {
		method,
		headers: inm === undefined ? {} : { "if-none-match": inm },
	});

describe("ifNoneMatchHits", () => {
	it("matches the tag, weak forms, lists and *", () => {
		expect(ifNoneMatchHits('"abc"', TAG)).toBe(true);
		expect(ifNoneMatchHits('W/"abc"', TAG)).toBe(true);
		expect(ifNoneMatchHits('"zzz", "abc"', TAG)).toBe(true);
		expect(ifNoneMatchHits("*", TAG)).toBe(true);
	});

	it("does not match another tag or no header", () => {
		expect(ifNoneMatchHits('"abcd"', TAG)).toBe(false);
		expect(ifNoneMatchHits("", TAG)).toBe(false);
		expect(ifNoneMatchHits(null, TAG)).toBe(false);
	});
});

describe("notModifiedFor", () => {
	it("is a 304 with the tag and no body for a GET that has it", async () => {
		const res = notModifiedFor(get('"abc"'), reply());
		expect(res?.status).toBe(304);
		expect(res?.headers.get("etag")).toBe(TAG);
		expect(await res?.text()).toBe("");
	});

	it("leaves a response alone when the tag differs, is missing, or is not a 200 GET", () => {
		expect(notModifiedFor(get('"other"'), reply())).toBeNull();
		expect(notModifiedFor(get(), reply())).toBeNull();
		expect(notModifiedFor(get('"abc"'), reply({}, null))).toBeNull();
		expect(notModifiedFor(get('"abc"', "POST"), reply())).toBeNull();
		expect(notModifiedFor(get('"abc"'), reply({ status: 500 }))).toBeNull();
	});
});
