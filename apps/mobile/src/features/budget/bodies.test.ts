import {
	assignBody,
	coverBody,
	limitBody,
	moveRequest,
	takeBackBody,
	usePlanBody,
} from "./bodies";

const ids = { batchId: "batch-1", itemId: "item-1" };
const base = { ...ids, month: 202610, envelopeId: "env-a", currency: "ARS" };

describe("budget request bodies", () => {
	it("assign sends decimal text in the currency's own decimals", () => {
		expect(assignBody({ ...base, mode: "set", minor: 1500050 })).toEqual({
			batchId: "batch-1",
			month: 202610,
			mode: "set",
			items: [{ id: "item-1", envelopeId: "env-a", amount: "15000.50" }],
		});
		// Setting to zero takes everything back.
		expect(assignBody({ ...base, mode: "set", minor: 0 }).items[0]?.amount).toBe(
			"0.00",
		);
		expect(
			assignBody({ ...base, currency: "JPY", mode: "add", minor: 800 }).items[0]
				?.amount,
		).toBe("800");
	});

	it("money into an envelope from the pool is an assign that adds", () => {
		const req = moveRequest({
			...base,
			direction: "in",
			peer: { kind: "pool" },
			minor: 250000,
		});
		expect(req.send).toBe("assign");
		expect(req.body).toMatchObject({ mode: "add", month: 202610 });
	});

	it("money in from another envelope is a MOVE to this one", () => {
		expect(
			moveRequest({
				...base,
				direction: "in",
				peer: { kind: "envelope", id: "env-b" },
				minor: 250000,
			}),
		).toEqual({
			send: "move",
			body: {
				id: "batch-1",
				month: 202610,
				from: "env-b",
				to: "env-a",
				amount: "2500.00",
				kind: "MOVE",
			},
		});
	});

	it("money out to the pool is an UNASSIGN, out to an envelope a MOVE", () => {
		expect(
			moveRequest({
				...base,
				direction: "out",
				peer: { kind: "pool" },
				minor: 100,
			}).body,
		).toMatchObject({ from: "env-a", to: null, kind: "UNASSIGN" });
		expect(
			moveRequest({
				...base,
				direction: "out",
				peer: { kind: "envelope", id: "env-b" },
				minor: 100,
			}).body,
		).toMatchObject({ from: "env-a", to: "env-b", kind: "MOVE" });
	});

	it("cover takes from a place or from the pool (null)", () => {
		expect(
			coverBody({
				id: "c1",
				month: 202610,
				envelopeId: "env-a",
				from: null,
				minor: 253000,
				currency: "ARS",
			}),
		).toEqual({
			id: "c1",
			month: 202610,
			envelopeId: "env-a",
			from: null,
			amount: "2530.00",
		});
	});

	it("Use my plan sends only the batch and where the rest goes", () => {
		expect(usePlanBody({ batchId: "b", rest: "LEAVE" })).toEqual({
			batchId: "b",
			rest: "LEAVE",
		});
		expect(takeBackBody("b")).toEqual({ batchId: "b" });
	});

	it("a limit carries its scope", () => {
		expect(
			limitBody({
				id: "l1",
				envelopeId: "env-a",
				minor: 7000000,
				currency: "ARS",
				scope: "FROM_NOW_ON",
			}),
		).toEqual({
			id: "l1",
			envelopeId: "env-a",
			amount: "70000.00",
			scope: "FROM_NOW_ON",
		});
	});
});
