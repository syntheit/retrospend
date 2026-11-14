import { describe, expect, it } from "vitest";
import { quote as quoteAt } from "~/server/services/payments/allocate";
import { myShareOf, shareAtHome } from "./page-figures";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const brl = (minor: number) => ({ minor, currency: "BRL" });
const quote = (perUnit: string) => quoteAt(perUnit, "blue");

describe("shareAtHome", () => {
	it("adds shares in other currencies at the reference rates", () => {
		const quotes = new Map([["BRL", quote("250")]]);
		expect(shareAtHome([ars(100000), brl(10000)], "ARS", quotes)).toEqual(
			ars(100000 + 2500000),
		);
	});

	it("is null when every line is home already", () => {
		expect(shareAtHome([ars(5000)], "ARS", new Map())).toBeNull();
	});

	it("is null without a share or a home currency", () => {
		expect(shareAtHome([], "ARS", new Map())).toBeNull();
		expect(shareAtHome([brl(100)], null, new Map())).toBeNull();
	});

	it("is null when a currency has no rate, never 1", () => {
		expect(shareAtHome([ars(100), brl(100)], "ARS", new Map())).toBeNull();
	});
});

describe("myShareOf", () => {
	const user = (participantId: string) => ({
		participantType: "user",
		participantId,
	});
	const row = (id: string, shareAmount: string, verificationStatus: string) => ({
		...user(id),
		shareAmount,
		verificationStatus,
	});
	// Ana paid 90,000: Ana 30,000, Bruno 30,000 rejected, Caro 30,000.
	const expense = {
		paidByType: "user",
		paidById: "ana",
		splitParticipants: [
			row("ana", "30000", "ACCEPTED"),
			row("bruno", "30000", "REJECTED"),
			row("caro", "30000", "ACCEPTED"),
		],
	};
	const asUser = (id: string) => (r: { participantId: string }) =>
		r.participantId === id;

	it("gives the payer the rejected share on top of their own: 30,000 + 30,000", () => {
		expect(myShareOf(expense, asUser("ana"))?.toString()).toBe("60000");
	});

	it("leaves the other accepted share as it is", () => {
		expect(myShareOf(expense, asUser("caro"))?.toString()).toBe("30000");
	});

	it("is null for the one who rejected, and for someone not in it", () => {
		expect(myShareOf(expense, asUser("bruno"))).toBeNull();
		expect(myShareOf(expense, asUser("dario"))).toBeNull();
	});

	it("does not count a payer's own rejected row twice", () => {
		const own = {
			...expense,
			splitParticipants: [
				row("ana", "30000", "REJECTED"),
				row("caro", "30000", "ACCEPTED"),
			],
		};
		expect(myShareOf(own, asUser("ana"))?.toString()).toBe("30000");
	});
});
