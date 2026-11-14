/**
 * One rule for which of your shares count, held by the same ledger on the
 * server and on a device. The server reads candidates in SQL and filters them
 * with countsAsShare (shareParticipations); a device holds the participations
 * GET /sync/shares hands it and filters them with the same function. Neither
 * side may keep a rule of its own, so both pick the same participations, and
 * the figure's inputs match.
 *
 * Every share of "me" is named `STATUS/project`: four statuses against five
 * project kinds. Hidden from reports means excludeFromAnalytics (the spending
 * readers leave it out); Not in budget is a routing (the envelope leaves it
 * out); "both" is the two at once. The two cross cases are the point: a
 * project hidden from reports but routed into the budget counts in the
 * envelope and not in spent, and a Not in budget project that reports still
 * show counts in spent and not in the envelope.
 *
 * Counted in spent (not rejected; outside hidden: none, shown, off):
 *   9 shares, three statuses against none, shown and off.
 * Counted in the envelope (not rejected; outside Not in budget: none, hidden,
 *   shown): 9 shares, three statuses against none, hidden and shown.
 * Beside them, rows that are not a reason to count differently: a negative
 * correction share, a share on an expense I paid, shares next to a guest and a
 * shadow, and an expense with only a guest in it (nobody's share but theirs).
 * Every share has its own amount, so a pairing by amount cannot hide a
 * mix-up, and every row has a captured rate, so rates never differ for a
 * reason outside the rule.
 */
import { randomUUID } from "node:crypto";
import {
	countsAsShare,
	type SpentShareRow,
	shareRateOf,
	spentInputsFromRows,
} from "@retrospend/domain/spent";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
	shareParticipations,
} from "~/server/services/shared-expense-integration";
import {
	readSettingsSnapshot,
	readShareSnapshot,
} from "~/server/services/sync/snapshots";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

const STATUSES = ["PENDING", "ACCEPTED", "AUTO_ACCEPTED", "REJECTED"] as const;
type Status = (typeof STATUSES)[number];
const KINDS = ["none", "hidden", "shown", "off", "both"] as const;
type Kind = (typeof KINDS)[number];

const DATE = new Date("2026-10-10T12:00:00Z");
const WIDE = {
	start: new Date("2000-01-01T00:00:00Z"),
	end: new Date("2100-01-01T00:00:00Z"),
};

let me: string;
/** A share's name by participation id, and its amount by name. */
const amountOf = new Map<string, string>();
const nameOfId = new Map<string, string>();

beforeAll(async () => {
	const { user } = await createTestUser();
	const { user: bob } = await createTestUser();
	me = user.id;
	await adminDb.user.update({
		where: { id: me },
		data: { homeCurrency: "ARS", timeZone: "UTC" },
	});

	const projects = new Map<Kind, string | null>([["none", null]]);
	for (const kind of KINDS.filter((k) => k !== "none")) {
		const project = await adminDb.project.create({
			data: { name: `Project ${kind}`, createdById: bob.id },
		});
		projects.set(kind, project.id);
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: me,
				excludeFromAnalytics: kind === "hidden" || kind === "both",
				budgetRouting:
					kind === "off" || kind === "both" ? "NOT_IN_BUDGET" : "CATEGORY",
			},
		});
	}

	let n = 0;
	const expense = async (
		name: string,
		o: {
			payer?: string;
			projectId?: string | null;
			correctsId?: string;
			shares: [type: "user" | "guest" | "shadow", id: string, status: Status][];
			amounts?: Record<string, string>;
		},
	) => {
		const payer = o.payer ?? bob.id;
		const transactionId = randomUUID();
		await adminDb.sharedTransaction.create({
			data: {
				id: transactionId,
				description: name,
				amount: new Prisma.Decimal(1_000),
				currency: "ARS",
				exchangeRate: new Prisma.Decimal(1_500),
				date: DATE,
				projectId: o.projectId ?? null,
				correctsId: o.correctsId ?? null,
				paidByType: "user",
				paidById: payer,
				createdByType: "user",
				createdById: payer,
				splitParticipants: {
					create: o.shares.map(([type, id, status]) => {
						const amount = o.amounts?.[`${type}:${id}`] ?? String(++n * 7);
						const participationId = randomUUID();
						if (id === me) {
							nameOfId.set(participationId, name);
							amountOf.set(name, new Prisma.Decimal(amount).toFixed());
						}
						return {
							id: participationId,
							participantType: type,
							participantId: id,
							shareAmount: new Prisma.Decimal(amount),
							verificationStatus: status,
						};
					}),
				},
			},
		});
		return transactionId;
	};

	let accepted = "";
	for (const status of STATUSES)
		for (const kind of KINDS) {
			const name = `${status}/${kind}`;
			const id = await expense(name, {
				projectId: projects.get(kind) ?? null,
				shares: [
					["user", me, status],
					["user", bob.id, "ACCEPTED"],
				],
			});
			if (name === "ACCEPTED/none") accepted = id;
		}

	// A correction entry: a negative share, which counts.
	await expense("correction", {
		correctsId: accepted,
		shares: [
			["user", me, "ACCEPTED"],
			["user", bob.id, "ACCEPTED"],
		],
		amounts: { [`user:${me}`]: "-5" },
	});
	// An expense I paid: my share counts, rejected or not by the same rule.
	await expense("paid-by-me", {
		payer: me,
		shares: [
			["user", me, "ACCEPTED"],
			["user", bob.id, "PENDING"],
		],
	});
	await expense("paid-by-me-rejected", {
		payer: me,
		shares: [
			["user", me, "REJECTED"],
			["user", bob.id, "ACCEPTED"],
		],
	});
	// A guest and a shadow beside me.
	await expense("with-guest", {
		shares: [
			["user", me, "ACCEPTED"],
			["guest", randomUUID(), "ACCEPTED"],
		],
	});
	await expense("with-shadow", {
		shares: [
			["user", me, "PENDING"],
			["shadow", randomUUID(), "ACCEPTED"],
		],
	});
	// Nobody's share but a guest's: not mine on either side.
	await expense("guest-only", {
		shares: [["guest", randomUUID(), "ACCEPTED"]],
	});
});

const EXTRAS_COUNTED = [
	"correction",
	"paid-by-me",
	"with-guest",
	"with-shadow",
];
const names = (kinds: readonly Kind[]) =>
	STATUSES.filter((s) => s !== "REJECTED").flatMap((s) =>
		kinds.map((k) => `${s}/${k}`),
	);

/** What the spending readers keep: outside the projects hidden from reports. */
const SPENT_EXPECTED = [
	...names(["none", "shown", "off"]),
	...EXTRAS_COUNTED,
].sort();
/** What the envelope keeps: outside the projects routed Not in budget. */
const ENVELOPE_EXPECTED = [
	...names(["none", "hidden", "shown"]),
	...EXTRAS_COUNTED,
].sort();

const namesOf = (ids: readonly string[]) =>
	ids.map((id) => nameOfId.get(id) ?? id).sort();

const notInBudgetIds = () =>
	adminDb.projectParticipant
		.findMany({
			where: {
				participantType: "user",
				participantId: me,
				budgetRouting: "NOT_IN_BUDGET",
			},
			select: { projectId: true },
		})
		.then((r) => r.map((p) => p.projectId));

describe("the share rule, on the server and on a device", () => {
	it("the ledger has every share of me, rejected ones included", async () => {
		// 20 named by status and project, and 5 extras (one of them rejected).
		const snapshot = await readShareSnapshot(adminDb, me);
		expect(snapshot.shares).toHaveLength(25);
		expect(nameOfId.size).toBe(25);
	});

	it("spent: the server and the device pick the same participations, the hand-listed ones", async () => {
		const hidden = await userTransaction(adminDb, me, (tx) =>
			getExcludedProjectIds(tx, me),
		);
		const server = await userTransaction(adminDb, me, (tx) =>
			shareParticipations(tx, me, undefined, hidden),
		);
		const snapshot = await readShareSnapshot(adminDb, me);
		const settings = await readSettingsSnapshot(adminDb, me);
		const device = snapshot.shares.filter((s) =>
			countsAsShare(s, settings.hiddenProjectIds),
		);

		expect(settings.hiddenProjectIds.sort()).toEqual([...hidden].sort());
		expect(namesOf(server.map((p) => p.id))).toEqual(SPENT_EXPECTED);
		expect(namesOf(device.map((s) => s.id))).toEqual(SPENT_EXPECTED);
	});

	it("spent: getSharedExpenseShares equals spentInputsFromRows over the synced rows, on the same rates", async () => {
		const server = await userTransaction(adminDb, me, async (tx) =>
			getSharedExpenseShares(
				tx,
				me,
				undefined,
				undefined,
				await getExcludedProjectIds(tx, me),
			),
		);
		const snapshot = await readShareSnapshot(adminDb, me);
		const settings = await readSettingsSnapshot(adminDb, me);
		const rows: SpentShareRow[] = snapshot.shares.map((s) => ({
			shareAmount: s.shareAmount.toFixed(),
			verificationStatus: s.verificationStatus,
			currency: s.currency,
			date: s.date,
			projectId: s.projectId,
			exchangeRate: s.exchangeRate?.toFixed() ?? null,
			categoryId: s.expenseCategoryId,
		}));
		const device = spentInputsFromRows({
			expenses: [],
			shares: rows,
			hiddenProjectIds: settings.hiddenProjectIds,
			range: WIDE,
			// Every row has a captured rate, so the table is never asked.
			rateFor: shareRateOf(() => null),
		}).shares;

		const byAmount = <T extends { amount: string }>(l: T[]) =>
			[...l].sort((a, b) => Number(a.amount) - Number(b.amount));
		expect(byAmount(server)).toEqual(byAmount(device));
		expect(server.map((s) => s.amount).sort()).toEqual(
			SPENT_EXPECTED.map((n) => amountOf.get(n) as string).sort(),
		);
	});

	it("envelope: with the Not in budget list as the hidden list, the same predicate picks the hand-listed ones", async () => {
		const off = await notInBudgetIds();
		const server = await userTransaction(adminDb, me, (tx) =>
			shareParticipations(tx, me, undefined, off),
		);
		const snapshot = await readShareSnapshot(adminDb, me);
		const device = snapshot.shares.filter((s) => countsAsShare(s, off));

		expect(off).toHaveLength(2);
		expect(namesOf(server.map((p) => p.id))).toEqual(ENVELOPE_EXPECTED);
		expect(namesOf(device.map((s) => s.id))).toEqual(ENVELOPE_EXPECTED);
	});

	it("a project hidden from reports but in the budget counts in the envelope, not in spent; a Not in budget one the other way", async () => {
		const spent = await userTransaction(adminDb, me, async (tx) =>
			namesOf(
				(
					await shareParticipations(
						tx,
						me,
						undefined,
						await getExcludedProjectIds(tx, me),
					)
				).map((p) => p.id),
			),
		);
		const envelope = await userTransaction(adminDb, me, async (tx) =>
			namesOf(
				(
					await shareParticipations(tx, me, undefined, await notInBudgetIds())
				).map((p) => p.id),
			),
		);
		expect(envelope).toContain("PENDING/hidden");
		expect(spent).not.toContain("PENDING/hidden");
		expect(spent).toContain("PENDING/off");
		expect(envelope).not.toContain("PENDING/off");
		// Both at once is in neither; a rejected share is in neither, anywhere.
		for (const l of [spent, envelope]) {
			expect(l).not.toContain("ACCEPTED/both");
			expect(l.filter((n) => n.startsWith("REJECTED/"))).toEqual([]);
			expect(l).not.toContain("paid-by-me-rejected");
		}
	});

	it("with no hidden list only rejected shares are dropped", async () => {
		const all = await userTransaction(adminDb, me, (tx) =>
			shareParticipations(tx, me),
		);
		// The five REJECTED/* shares and the rejected one I paid for are out.
		expect(all).toHaveLength(25 - 5 - 1);
		expect(namesOf(all.map((p) => p.id))).not.toContain("REJECTED/none");
		expect(namesOf(all.map((p) => p.id))).toContain("PENDING/both");
	});
});
