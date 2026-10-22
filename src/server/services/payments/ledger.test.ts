import { describe, expect, it } from "vitest";
import { findClaimMatch } from "./claim-match";
import { countsFor, ledgerLines, type PairEvent, settledSince } from "./ledger";

const share = (
	date: string,
	minor: number,
	scope: string | null = null,
): PairEvent => ({
	date,
	scope,
	currency: "ARS",
	minor,
	kind: "share",
});
const paid = (date: string, minor: number, pending = false): PairEvent => ({
	date,
	scope: null,
	currency: "ARS",
	minor,
	kind: "payment",
	pending,
});

describe("ledgerLines", () => {
	it("dates a line by its oldest share not yet covered, first in first out", () => {
		// Owed 100 (Oct 1) + 50 (Oct 5); 120 paid back: the Oct 5 share is open.
		const [line] = ledgerLines([
			share("2026-10-01", 100),
			share("2026-10-05", 50),
			paid("2026-10-06", -120),
		]);
		expect(line).toEqual({
			scope: null,
			currency: "ARS",
			balance: 30,
			oldest: "2026-10-05",
		});
	});

	it("drops lines that are exactly zero", () => {
		expect(
			ledgerLines([share("2026-10-01", 100), paid("2026-10-02", -100)]),
		).toEqual([]);
	});
});

describe("settledSince", () => {
	it("is the date of the record that brought every balance to zero", () => {
		const s = settledSince([
			share("2026-10-01", 100),
			paid("2026-10-16", -100),
		]);
		expect(s.overall).toBe("2026-10-16");
	});

	it("never comes from an older zero once a balance moved again", () => {
		const s = settledSince([
			share("2026-10-01", 100),
			paid("2026-10-16", -100),
			share("2026-10-20", -50),
			paid("2026-10-21", 50, true),
		]);
		expect(s).toMatchObject({ overall: "2026-10-21", pending: true });
	});

	it("counts a day's records together before deciding", () => {
		const s = settledSince([
			share("2026-10-01", 100),
			paid("2026-10-01", -100),
		]);
		expect(s.overall).toBe("2026-10-01");
	});

	it("tracks each scope on its own", () => {
		const s = settledSince([
			share("2026-10-01", 100, "a"),
			share("2026-10-02", 50, "b"),
			paid("2026-10-03", -50),
		]);
		expect(s.overall).toBeNull();
		expect(s.byScope.get("a")).toBeNull();
	});
});

describe("countsFor", () => {
	const pendingFromPayer = {
		status: "PROPOSED",
		confirmedByPayer: true,
		confirmedByPayee: false,
	};
	it("counts a pending payment for its recorder only", () => {
		expect(countsFor(pendingFromPayer, "from")).toBe(true);
		expect(countsFor(pendingFromPayer, "to")).toBe(false);
		expect(countsFor(pendingFromPayer, null)).toBe(false);
	});
	it("counts final rows for everyone and rejected rows for nobody", () => {
		expect(countsFor({ ...pendingFromPayer, status: "FINALIZED" }, null)).toBe(
			true,
		);
		expect(countsFor({ ...pendingFromPayer, status: "REJECTED" }, "from")).toBe(
			false,
		);
	});
});

describe("findClaimMatch", () => {
	const claim = {
		paymentId: "c1",
		amount: 2_000_000,
		currency: "ARS",
		paidOn: "2026-10-20",
		paymentMethod: "Cash",
	};
	const none = () => null;

	it("matches within 2% and 7 days and says when the amounts differ", () => {
		const m = findClaimMatch(
			[claim],
			{ amount: 1_970_000, currency: "ARS", paidOn: "2026-10-21" },
			none,
		);
		expect(m).toMatchObject({ claim: { paymentId: "c1" }, sameAmount: false });
	});

	it("does not match past 2% or 7 days", () => {
		expect(
			findClaimMatch(
				[claim],
				{ amount: 1_800_000, currency: "ARS", paidOn: "2026-10-21" },
				none,
			),
		).toBeNull();
		expect(
			findClaimMatch(
				[claim],
				{ amount: 2_000_000, currency: "ARS", paidOn: "2026-10-28" },
				none,
			),
		).toBeNull();
	});

	it("matches another currency only through a quote", () => {
		const brl = { ...claim, amount: 7_380, currency: "BRL" };
		const payment = {
			amount: 2_000_000,
			currency: "ARS",
			paidOn: "2026-10-21",
		};
		expect(findClaimMatch([brl], payment, none)).toBeNull();
		expect(
			findClaimMatch([brl], payment, (minor) => minor * 271),
		).toMatchObject({ amountInPaymentCurrency: 1_999_980 });
	});

	it("prefers the closest amount", () => {
		const near = { ...claim, paymentId: "c2", amount: 2_010_000 };
		const far = { ...claim, paymentId: "c3", amount: 2_030_000 };
		expect(
			findClaimMatch(
				[far, near],
				{ amount: 2_000_000, currency: "ARS", paidOn: "2026-10-21" },
				none,
			)?.claim.paymentId,
		).toBe("c2");
	});
});
