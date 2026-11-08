/**
 * The device loader of Activity rows selects, from the rows a device holds,
 * what the SQL loader reads: your own expenses, your split rows, payments
 * between you and someone. The conformance pg test checks the two against one
 * ledger; these are the rules by hand.
 */
import { describe, expect, it } from "vitest";
import { activityRowsFrom, rowKeyFromEntryId } from "./activity-rows";
import {
	type ActivityStore,
	activityInputsFromRows,
	type StoredExpense,
	type StoredSettlement,
} from "./activity-rows-store";

const ME = "me";
const key = rowKeyFromEntryId;

const expense = (
	o: Partial<StoredExpense> & { id: string },
): StoredExpense => ({
	userId: ME,
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	title: o.id,
	amount: "100",
	currency: "ARS",
	amountInUSD: "0.07",
	homeCurrency: null,
	homeAmount: null,
	homeRate: null,
	rateType: null,
	date: new Date("2026-10-08T15:00:00Z"),
	excludeFromAnalytics: false,
	isAmortizedParent: false,
	categoryId: null,
	parentId: null,
	...o,
});

const settlement = (
	o: Partial<StoredSettlement> & { id: string },
): StoredSettlement => ({
	paymentGroupId: null,
	currency: "ARS",
	amount: "500",
	status: "FINALIZED",
	initiatedAt: new Date("2026-10-10T15:00:00Z"),
	fromParticipantType: "user",
	fromParticipantId: "ben",
	toParticipantType: "user",
	toParticipantId: ME,
	projectId: null,
	isOffset: false,
	kind: "PAYMENT",
	...o,
});

const store = (o: Partial<ActivityStore> = {}): ActivityStore => ({
	userId: ME,
	expenses: [],
	categories: [],
	splits: [],
	transactions: [],
	projects: [],
	settlements: [],
	memberships: [],
	people: {},
	rateRows: [],
	...o,
});

describe("activityInputsFromRows", () => {
	it("takes only your own expenses among the page's ids, and counts their monthly parts", () => {
		const s = store({
			expenses: [
				expense({ id: "a", isAmortizedParent: true }),
				expense({ id: "a1", parentId: "a" }),
				expense({ id: "a2", parentId: "a" }),
				expense({ id: "b" }),
				expense({ id: "theirs", userId: "ben" }),
			],
		});
		const { personal } = activityInputsFromRows(s, [key("a"), key("theirs")]);
		expect(personal.map((p) => [p.id, p.childCount])).toEqual([["a", 2]]);
	});

	it("takes your split row of a shared expense, with every participant row of it", () => {
		const s = store({
			transactions: [
				{
					id: "t",
					description: "Dinner",
					amount: "9000",
					currency: "ARS",
					exchangeRate: null,
					date: new Date("2026-10-09T15:00:00Z"),
					paidByType: "user",
					paidById: "ben",
					createdByType: "user",
					createdById: "ben",
					isLocked: false,
					projectId: "pr",
					categoryId: null,
				},
				{
					id: "other",
					description: "Elsewhere",
					amount: "1",
					currency: "ARS",
					exchangeRate: null,
					date: new Date("2026-10-09T15:00:00Z"),
					paidByType: "user",
					paidById: "ben",
					createdByType: "user",
					createdById: "ben",
					isLocked: false,
					projectId: null,
					categoryId: null,
				},
			],
			splits: [
				{
					transactionId: "t",
					participantType: "user",
					participantId: ME,
					shareAmount: "3000",
					verificationStatus: "ACCEPTED",
				},
				{
					transactionId: "t",
					participantType: "user",
					participantId: "ben",
					shareAmount: "6000",
					verificationStatus: "ACCEPTED",
				},
				{
					transactionId: "other",
					participantType: "user",
					participantId: "ben",
					shareAmount: "1",
					verificationStatus: "ACCEPTED",
				},
			],
			projects: [{ id: "pr", name: "Trip" }],
			people: {
				"user:ben": { name: "Ben", imageUrl: null },
				"user:zed": { name: "Zed", imageUrl: null },
			},
			memberships: [
				{
					projectId: "pr",
					participantType: "user",
					participantId: ME,
					role: "CONTRIBUTOR",
				},
				{
					projectId: "pr",
					participantType: "shadow",
					participantId: ME,
					role: "ORGANIZER",
				},
				{
					projectId: "pr",
					participantType: "user",
					participantId: "ben",
					role: "ORGANIZER",
				},
			],
		});
		const inputs = activityInputsFromRows(s, [
			key("shared:t"),
			key("shared:other"),
		]);
		expect(inputs.shares).toHaveLength(1);
		expect(inputs.shares[0]?.transaction.project).toEqual({
			id: "pr",
			name: "Trip",
		});
		expect(inputs.shares[0]?.transaction.splitParticipants).toEqual([
			{ participantType: "user", participantId: ME },
			{ participantType: "user", participantId: "ben" },
		]);
		// Only the caller's own membership counts, and only for the page's projects.
		expect(inputs.roles).toEqual({ pr: "CONTRIBUTOR" });
		// Names only for the people on these rows.
		expect(Object.keys(inputs.who)).toEqual(["user:ben"]);
		// Shaped, it is the row Activity shows.
		const [row] = activityRowsFrom([key("shared:t")], inputs, {
			userId: ME,
			timeZone: "UTC",
			rates: { home: "ARS", homeRate: 1500 },
		});
		expect(row).toMatchObject({
			amount: { minor: 900_000, currency: "ARS" },
			share: { minor: 300_000, currency: "ARS" },
			canEdit: false,
		});
	});

	it("takes only payments: not an offset, a refund kind, a rejected one or a pair of other people", () => {
		const s = store({
			settlements: [
				settlement({ id: "ok" }),
				settlement({ id: "offset", isOffset: true }),
				settlement({ id: "kind", kind: "REIMBURSEMENT" }),
				settlement({ id: "rejected", status: "REJECTED" }),
				settlement({
					id: "others",
					fromParticipantId: "cam",
					toParticipantId: "ben",
				}),
				settlement({ id: "g1", paymentGroupId: "grp" }),
				settlement({ id: "g2", paymentGroupId: "grp", currency: "USD" }),
				// A row whose own id is a group id counts only when it has no group.
				settlement({ id: "grp-member", paymentGroupId: "elsewhere" }),
			],
		});
		const { payments } = activityInputsFromRows(s, [
			key("payment:ok|ARS"),
			key("payment:offset|ARS"),
			key("payment:kind|ARS"),
			key("payment:rejected|ARS"),
			key("payment:others|ARS"),
			key("payment:grp|ARS"),
		]);
		expect(payments.map((p) => p.id).sort()).toEqual(["g1", "g2", "ok"]);
	});

	it("reads rate rows only for the currencies that need pricing", () => {
		const row = (currency: string) => ({
			currency,
			type: "official",
			rate: "2",
			date: new Date("2026-10-01T00:00:00Z"),
		});
		const s = store({
			settlements: [settlement({ id: "p", currency: "EUR" })],
			rateRows: [row("EUR"), row("GBP"), row("USD")],
		});
		const { rateRows } = activityInputsFromRows(s, [key("payment:p|EUR")]);
		expect(Object.keys(rateRows)).toEqual(["EUR"]);
		expect(rateRows.EUR).toEqual([
			{ type: "official", rate: 2, date: new Date("2026-10-01T00:00:00Z") },
		]);
	});
});
