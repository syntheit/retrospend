import {
	affordQuery,
	createEnvelopeBody,
	debtPaymentBody,
	mergeBody,
	nameOk,
	reconcileBody,
	styleBody,
	targetBody,
	updateEnvelopeBody,
} from "./moreBodies";

const ID = "00000000-0000-4000-8000-000000000001";

describe("envelope bodies", () => {
	it("creates an envelope with a trimmed name, no target and no categories", () => {
		expect(
			createEnvelopeBody({ id: ID, name: "  Pets ", groupId: null }),
		).toEqual({
			id: ID,
			name: "Pets",
			groupId: null,
			kind: "NONE",
			categoryIds: [],
		});
		expect(nameOk("   ")).toBe(false);
		expect(nameOk("a")).toBe(true);
	});

	it("sends only what changed, and nothing when nothing did", () => {
		const was = { name: "Food", groupId: "g1" };
		const base = { id: ID, envelopeId: "e1", was };
		expect(
			updateEnvelopeBody({ ...base, name: "Food", groupId: "g1" }),
		).toBeNull();
		expect(
			updateEnvelopeBody({ ...base, name: "Groceries", groupId: "g1" }),
		).toEqual({ id: ID, envelopeId: "e1", name: "Groceries" });
		expect(
			updateEnvelopeBody({ ...base, name: "Food", groupId: null }),
		).toEqual({ id: ID, envelopeId: "e1", groupId: null });
		// An emptied name is not a rename.
		expect(
			updateEnvelopeBody({ ...base, name: " ", groupId: "g1" }),
		).toBeNull();
	});
});

describe("combine body", () => {
	it("needs a stayer and at least one other envelope", () => {
		const base = { id: ID, name: "", was: "Food" };
		expect(mergeBody({ ...base, intoId: null, fromIds: ["a"] })).toBeNull();
		expect(mergeBody({ ...base, intoId: "s", fromIds: [] })).toBeNull();
		// The stayer is never in its own list.
		expect(mergeBody({ ...base, intoId: "s", fromIds: ["s"] })).toBeNull();
		expect(
			mergeBody({ ...base, intoId: "s", fromIds: ["s", "a", "b"] }),
		).toEqual({ id: ID, intoId: "s", fromIds: ["a", "b"] });
	});

	it("renames the stayer only when the name differs", () => {
		const base = { id: ID, intoId: "s", fromIds: ["a"], was: "Food" };
		expect(mergeBody({ ...base, name: "Food" })).not.toHaveProperty("name");
		expect(mergeBody({ ...base, name: " Eating out " })).toMatchObject({
			name: "Eating out",
		});
	});
});

describe("target body", () => {
	const base = { id: ID, envelopeId: "e1", mode: "REFILL" as const };
	it("clears a target without an amount", () => {
		expect(
			targetBody({ ...base, choice: "NONE", minor: null, currency: "ARS" }),
		).toEqual({ id: ID, envelopeId: "e1", kind: "NONE", target: null });
	});

	it("waits for an amount, then sends decimal text in major units", () => {
		expect(
			targetBody({ ...base, choice: "MONTHLY", minor: null, currency: "ARS" }),
		).toBeNull();
		expect(
			targetBody({
				...base,
				choice: "MONTHLY",
				mode: "SET_ASIDE",
				minor: 5_000_050,
				currency: "ARS",
			}),
		).toEqual({
			id: ID,
			envelopeId: "e1",
			kind: "MONTHLY",
			target: {
				kind: "MONTHLY",
				amount: "50000.50",
				mode: "SET_ASIDE",
				cadence: "MONTH",
			},
		});
		expect(
			targetBody({
				...base,
				choice: "SAVINGS",
				minor: 100_000,
				currency: "JPY",
			}),
		).toMatchObject({
			kind: "SAVINGS",
			target: { kind: "SAVINGS", amount: "100000" },
		});
	});
});

describe("style body", () => {
	it("switches between income styles with nothing else", () => {
		expect(
			styleBody({
				id: ID,
				style: "FLEX",
				from: "EVERY_DOLLAR",
				haveNowMinor: 500,
				currency: "USD",
			}),
		).toEqual({ id: ID, style: "FLEX", leftovers: "STYLE_DEFAULT" });
	});

	it("asks how much you have when leaving Limits, zero included", () => {
		const base = {
			id: ID,
			style: "FLEX" as const,
			from: "LIMITS",
			currency: "USD",
		};
		expect(styleBody({ ...base, haveNowMinor: null })).toBeNull();
		expect(styleBody({ ...base, haveNowMinor: 0 })).toMatchObject({
			haveNow: "0.00",
		});
		expect(styleBody({ ...base, haveNowMinor: 123_45 })).toMatchObject({
			haveNow: "123.45",
		});
	});
});

describe("afford and debt payment bodies", () => {
	it("asks one amount, optionally for one envelope", () => {
		expect(
			affordQuery({
				month: 202610,
				minor: 2_500,
				currency: "USD",
				envelopeId: null,
			}),
		).toEqual({ month: 202610, amount: "25.00" });
		expect(
			affordQuery({
				month: 202610,
				minor: 2_500,
				currency: "USD",
				envelopeId: "e1",
			}),
		).toEqual({ month: 202610, amount: "25.00", envelopeId: "e1" });
	});

	it("pays principal only, from a place and an envelope, nulls for the pool and not tracked", () => {
		const base = {
			id: ID,
			fromAccountId: null,
			envelopeId: null,
			currency: "ARS",
		};
		expect(
			debtPaymentBody({ ...base, liabilityId: null, minor: 100 }),
		).toBeNull();
		expect(
			debtPaymentBody({ ...base, liabilityId: "l1", minor: null }),
		).toBeNull();
		expect(
			debtPaymentBody({ ...base, liabilityId: "l1", minor: 1_000_000 }),
		).toEqual({
			id: ID,
			liabilityId: "l1",
			fromAccountId: null,
			envelopeId: null,
			principal: "10000.00",
			interest: "0",
		});
	});
});

describe("bank check body", () => {
	it("sends what the bank says as decimal text, negative included, and waits for a figure", () => {
		expect(reconcileBody({ id: ID, minor: null, currency: "ARS" })).toBeNull();
		expect(reconcileBody({ id: ID, minor: 150_025, currency: "ARS" })).toEqual({
			id: ID,
			bank: "1500.25",
		});
		expect(reconcileBody({ id: ID, minor: -2_000, currency: "ARS" })).toEqual({
			id: ID,
			bank: "-20.00",
		});
	});
});
