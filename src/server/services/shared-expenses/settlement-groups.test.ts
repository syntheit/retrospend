import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	allocateFullSettlement,
	reverseScopeDebtsForCurrency,
	scopeDebtsForCurrency,
} from "./settlement-allocation";
import {
	type GroupRow,
	groupRoles,
	groupRows,
	summarizeGroup,
} from "./settlement-groups";

const sum = (rows: Array<{ amount: number }>) =>
	rows.reduce((total, r) => total + r.amount, 0);

describe("allocateFullSettlement", () => {
	it("Trip/Rent: pays the net in cash and offsets the opposite debts", () => {
		// You owe Bob 50 in Trip, Bob owes you 30 in Rent: globally you owe 20.
		const rows = allocateFullSettlement(
			[{ projectId: "trip", owed: 50 }],
			[{ projectId: "rent", owed: 30 }],
			20,
		);
		expect(rows.cash).toEqual([{ projectId: "trip", amount: 20 }]);
		expect(rows.payerOffsets).toEqual([{ projectId: "trip", amount: 30 }]);
		expect(rows.payeeOffsets).toEqual([{ projectId: "rent", amount: 30 }]);
		// Cash moved is exactly the net; the offsets cancel out.
		expect(sum(rows.cash)).toBe(20);
		expect(sum(rows.payerOffsets)).toBe(sum(rows.payeeOffsets));
	});

	it("brings every scope to zero across several projects", () => {
		const payer = [
			{ projectId: "a", owed: 10 },
			{ projectId: "b", owed: 45 },
			{ projectId: null, owed: 5 },
		];
		const payee = [
			{ projectId: "c", owed: 12 },
			{ projectId: "d", owed: 8 },
		];
		const net = 10 + 45 + 5 - 12 - 8;
		const rows = allocateFullSettlement(payer, payee, net);

		const left = new Map<string | null, number>();
		for (const d of payer) left.set(d.projectId, -d.owed);
		for (const d of payee) left.set(d.projectId, d.owed);
		for (const r of [...rows.cash, ...rows.payerOffsets])
			left.set(r.projectId, (left.get(r.projectId) ?? 0) + r.amount);
		for (const r of rows.payeeOffsets)
			left.set(r.projectId, (left.get(r.projectId) ?? 0) - r.amount);
		for (const value of left.values()) expect(value).toBeCloseTo(0, 8);
		expect(sum(rows.cash)).toBeCloseTo(net, 8);
	});

	it("without opposite debts it is a plain allocation (no offsets)", () => {
		const rows = allocateFullSettlement(
			[
				{ projectId: "a", owed: 60 },
				{ projectId: "b", owed: 40 },
			],
			[],
			100,
		);
		expect(rows.cash).toEqual([
			{ projectId: "b", amount: 40 },
			{ projectId: "a", amount: 60 },
		]);
		expect(rows.payerOffsets).toEqual([]);
		expect(rows.payeeOffsets).toEqual([]);
	});

	it("reads both directions of one currency only", () => {
		const byProject = new Map<string | null, Record<string, number>>([
			["trip", { USD: -50, ARS: 30000 }],
			["rent", { USD: 30 }],
		]);
		expect(scopeDebtsForCurrency(byProject, "USD")).toEqual([
			{ projectId: "trip", owed: 50 },
		]);
		expect(reverseScopeDebtsForCurrency(byProject, "USD")).toEqual([
			{ projectId: "rent", owed: 30 },
		]);
		expect(reverseScopeDebtsForCurrency(byProject, "ARS")).toEqual([
			{ projectId: "trip", owed: 30000 },
		]);
	});
});

// ── group roles ───────────────────────────────────────────────────────────────

function row(overrides: Partial<GroupRow> & { id: string }): GroupRow {
	return {
		fromParticipantType: "user",
		fromParticipantId: "alice",
		toParticipantType: "user",
		toParticipantId: "bob",
		amount: 10,
		currency: "USD",
		status: "PROPOSED",
		confirmedByPayer: true,
		confirmedByPayee: false,
		autoConfirmedReason: null,
		projectId: null,
		paymentGroupId: "g1",
		isOffset: false,
		...overrides,
	};
}

/** alice paid bob 20 into Trip and offset 30 Trip against Rent. */
const pendingGroup = [
	row({ id: "cash", amount: 20, projectId: "trip" }),
	row({ id: "off-out", amount: 30, projectId: "trip", isOffset: true }),
	row({
		id: "off-in",
		amount: 30,
		projectId: "rent",
		isOffset: true,
		fromParticipantId: "bob",
		toParticipantId: "alice",
		// Flags swapped: alice (the recorder) is this row's payee.
		confirmedByPayer: false,
		confirmedByPayee: true,
	}),
];

describe("groupRoles", () => {
	it("waits for the other person on every row, whichever way it points", () => {
		expect(groupRoles(pendingGroup, "bob")).toMatchObject({
			isParty: true,
			status: "PROPOSED",
			awaitingMe: true,
			recordedByMe: false,
		});
		expect(groupRoles(pendingGroup, "alice")).toMatchObject({
			awaitingMe: false,
			recordedByMe: true,
		});
		expect(groupRoles(pendingGroup, "carol").isParty).toBe(false);
	});

	it("lets the payee void a payment they recorded, never one confirmed by a user", () => {
		const recorded = pendingGroup.map((r) => ({
			...r,
			status: "FINALIZED",
			autoConfirmedReason: "Recorded by the payee as a payment received",
			// bob recorded receiving it: bob's flag true on every row.
			confirmedByPayer: r.fromParticipantId === "bob",
			confirmedByPayee: r.toParticipantId === "bob",
		}));
		expect(groupRoles(recorded, "bob").canVoid).toBe(true);
		expect(groupRoles(recorded, "alice").canVoid).toBe(false);

		const confirmed = pendingGroup.map((r) => ({
			...r,
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
		}));
		expect(groupRoles(confirmed, "alice").canVoid).toBe(false);
		expect(groupRoles(confirmed, "bob").canVoid).toBe(false);
	});

	it("an auto-finalized payment to a ghost is voidable by the user", () => {
		const toShadow = [
			row({
				id: "s",
				toParticipantType: "shadow",
				toParticipantId: "ghost",
				status: "FINALIZED",
				confirmedByPayee: true,
				autoConfirmedReason: "Recipient is a shadow and cannot confirm",
			}),
		];
		expect(groupRoles(toShadow, "alice").canVoid).toBe(true);
	});

	it("a rejected row makes the whole group rejected", () => {
		const mixed = [
			row({ id: "a" }),
			row({ id: "b", status: "REJECTED" }),
		];
		expect(groupRoles(mixed, "bob")).toMatchObject({
			status: "REJECTED",
			awaitingMe: false,
		});
	});
});

describe("summarizeGroup", () => {
	it("shows cash, offsets and per-project parts of one payment", () => {
		const summary = summarizeGroup(pendingGroup, "alice");
		expect(summary).toMatchObject({
			kind: "payment",
			direction: "outgoing",
			amount: 20,
			currency: "USD",
			cashByCurrency: [{ currency: "USD", amount: 20 }],
			offsetByCurrency: [{ currency: "USD", amount: 30 }],
		});
		expect(summary.parts).toEqual([
			{ projectId: "trip", currency: "USD", amount: 20, isOffset: false, direction: "outgoing" },
			{ projectId: "trip", currency: "USD", amount: 30, isOffset: true, direction: "outgoing" },
			{ projectId: "rent", currency: "USD", amount: 30, isOffset: true, direction: "incoming" },
		]);
		// From bob's side the same payment is incoming.
		expect(summarizeGroup(pendingGroup, "bob").direction).toBe("incoming");
	});

	it("a group with offsets only is a square-up", () => {
		const squareUp = pendingGroup.filter((r) => r.isOffset);
		expect(summarizeGroup(squareUp, "alice")).toMatchObject({
			kind: "square_up",
			amount: 30,
			cashByCurrency: [],
		});
	});

	it("a multi-currency payment totals in the payment currency", () => {
		const rows = [
			row({ id: "usd", amount: 10, currency: "USD" }),
			row({
				id: "eur",
				amount: 6,
				currency: "EUR",
				convertedAmount: 2,
				convertedCurrency: "USD",
			}),
		];
		expect(summarizeGroup(rows, "alice")).toMatchObject({
			amount: 12,
			currency: "USD",
		});
	});
});

describe("groupRows", () => {
	it("keeps legacy rows without a group id apart", () => {
		const groups = groupRows([
			{ id: "1", paymentGroupId: "g" },
			{ id: "2", paymentGroupId: null },
			{ id: "3", paymentGroupId: "g" },
			{ id: "4", paymentGroupId: null },
		]);
		expect(groups.map((g) => g.map((r) => r.id))).toEqual([
			["1", "3"],
			["2"],
			["4"],
		]);
	});
});

// ── legacy backfill clustering ────────────────────────────────────────────────

/**
 * The migration 20261022000000_settlement_payment_groups gives legacy rows a
 * shared paymentGroupId when one settle-up call created them. This is the
 * same rule in TS: same pair (in that direction), same initiatedAt to the
 * millisecond, same currency, and only clusters of two or more rows.
 */
function legacyClusters(
	rows: Array<{
		id: string;
		from: string;
		to: string;
		initiatedAt: Date;
		currency: string;
	}>,
): string[][] {
	const clusters = new Map<string, string[]>();
	for (const r of rows) {
		const key = `${r.from}|${r.to}|${r.initiatedAt.getTime()}|${r.currency}`;
		clusters.set(key, [...(clusters.get(key) ?? []), r.id]);
	}
	return [...clusters.values()].filter((ids) => ids.length > 1);
}

describe("legacy backfill clustering", () => {
	const at = new Date("2026-09-01T10:00:00.123Z");
	const base = { from: "user:alice", to: "user:bob", initiatedAt: at, currency: "USD" };

	it("groups the rows of one call and leaves single payments alone", () => {
		expect(
			legacyClusters([
				// One global payment split over two projects.
				{ id: "trip", ...base },
				{ id: "rent", ...base },
				// A later single-row payment.
				{ id: "later", ...base, initiatedAt: new Date(at.getTime() + 1) },
				// Same millisecond, other currency of a settleAll: its own group.
				{ id: "ars", ...base, currency: "ARS" },
				// Same millisecond, other direction: a different payment.
				{ id: "back", ...base, from: "user:bob", to: "user:alice" },
			]),
		).toEqual([["trip", "rent"]]);
	});

	it("the migration clusters on exactly these columns", () => {
		const sql = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261022000000_settlement_payment_groups/migration.sql",
			),
			"utf8",
		);
		const groupBy = sql
			.slice(sql.indexOf("GROUP BY"), sql.indexOf("HAVING"))
			.replace(/\s+/g, " ");
		expect(groupBy).toContain(
			'"fromParticipantType", "fromParticipantId", "toParticipantType", "toParticipantId", date_trunc(\'milliseconds\', "initiatedAt"), "currency"',
		);
		expect(sql).toContain("HAVING COUNT(*) > 1");
		expect(sql).toContain('WHERE s."paymentGroupId" IS NULL');
		expect(sql).toContain("AS MATERIALIZED");
	});
});
