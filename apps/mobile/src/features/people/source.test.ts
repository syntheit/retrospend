import { keyOf, personCache, refOfKey } from "./source";

describe("person keys", () => {
	it("round-trips the key the server names a person by", () => {
		expect(keyOf({ type: "shadow", id: "e2e_shadow_paz" })).toBe(
			"shadow:e2e_shadow_paz",
		);
		expect(refOfKey("user:abc")).toEqual({ type: "user", id: "abc" });
		expect(refOfKey("guest:a:b")).toEqual({ type: "guest", id: "a:b" });
	});

	it("refuses a key that names no kind of person", () => {
		expect(refOfKey("abc")).toBeNull();
		expect(refOfKey("robot:abc")).toBeNull();
		expect(refOfKey(":abc")).toBeNull();
	});

	it("caches each person on their own entry", () => {
		expect(personCache({ type: "user", id: "a" }).name).not.toBe(
			personCache({ type: "user", id: "b" }).name,
		);
	});
});
