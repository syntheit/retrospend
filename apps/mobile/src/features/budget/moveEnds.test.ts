import { firstEnds, pickEnd, POOL, readEnds } from "./moveEnds";

const SELF = "env-groceries";

describe("Move money ends", () => {
	it("starts from the pool into the envelope when the pool has money", () => {
		expect(
			firstEnds(SELF, [
				{ id: POOL, minor: 5_000 },
				{ id: "env-rent", minor: 1_000 },
			]),
		).toEqual({ from: POOL, to: SELF });
	});

	it("starts from the first envelope with money when the pool is empty", () => {
		expect(
			firstEnds(SELF, [
				{ id: POOL, minor: 0 },
				{ id: SELF, minor: 900 },
				{ id: "env-rent", minor: 1_000 },
			]),
		).toEqual({ from: "env-rent", to: SELF });
	});

	it("starts with the envelope giving to the pool when nothing else has money", () => {
		expect(firstEnds(SELF, [{ id: POOL, minor: 0 }])).toEqual({
			from: SELF,
			to: POOL,
		});
	});

	it("keeps the envelope on the other side when another place is picked", () => {
		const start = { from: POOL, to: SELF };
		expect(pickEnd(start, "from", "env-rent", SELF)).toEqual({
			from: "env-rent",
			to: SELF,
		});
		// Picking another place as the To turns the move around.
		expect(pickEnd(start, "to", "env-rent", SELF)).toEqual({
			from: SELF,
			to: "env-rent",
		});
	});

	it("sends the other side to the pool when the envelope is picked on both", () => {
		expect(pickEnd({ from: POOL, to: SELF }, "from", SELF, SELF)).toEqual({
			from: SELF,
			to: POOL,
		});
		expect(pickEnd({ from: SELF, to: POOL }, "to", SELF, SELF)).toEqual({
			from: POOL,
			to: SELF,
		});
	});

	it("reads money into the envelope as in and out of it as out", () => {
		expect(readEnds({ from: POOL, to: SELF }, SELF)).toEqual({
			direction: "in",
			peer: { kind: "pool" },
		});
		expect(readEnds({ from: SELF, to: "env-rent" }, SELF)).toEqual({
			direction: "out",
			peer: { kind: "envelope", id: "env-rent" },
		});
		expect(readEnds({ from: "a", to: "b" }, SELF)).toBeNull();
		expect(readEnds({ from: SELF, to: SELF }, SELF)).toBeNull();
	});
});
