import { beforeEach, describe, expect, it, vi } from "vitest";

// PeopleService imports ~/server/storage (getImageUrl), which transitively
// imports src/env.js (t3-env) and requires DATABASE_URL etc. Mock it so the
// service can be exercised with the in-memory stateful DB alone.
vi.mock("~/server/storage", () => ({
	getImageUrl: (path: string | null) => path,
}));

import {
	addUser,
	createStatefulDb,
	makeUserRef,
	type SplitRecord,
	type TxRecord,
} from "./test-utils";
import { PeopleService } from "./people.service";

type Db = ReturnType<typeof createStatefulDb>;

let txSeq = 0;
let spSeq = 0;

/**
 * Insert a transaction directly into the in-memory stores. `paidBy` is the
 * payer; `splits` are the split-participant rows (which may or may not include
 * the payer — mirroring real data where a payer can take no share).
 */
function addTransaction(
	db: Db,
	opts: {
		paidBy: { participantType: string; participantId: string };
		splits: Array<{
			participantType: string;
			participantId: string;
			shareAmount: number;
		}>;
		amount: number;
		currency?: string;
		date?: Date;
	},
): string {
	const id = `txn-${++txSeq}`;
	const record: TxRecord = {
		id,
		description: `Tx ${id}`,
		amount: opts.amount,
		currency: opts.currency ?? "USD",
		date: opts.date ?? new Date("2026-01-01"),
		paidByType: opts.paidBy.participantType,
		paidById: opts.paidBy.participantId,
		createdByType: opts.paidBy.participantType,
		createdById: opts.paidBy.participantId,
		splitMode: "EXACT",
		projectId: null,
		billingPeriodId: null,
		isLocked: false,
		notes: null,
		receiptUrl: null,
		categoryId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	db._stores.transactions.set(id, record);

	for (const s of opts.splits) {
		const spId = `sp-${++spSeq}`;
		const split: SplitRecord = {
			id: spId,
			transactionId: id,
			participantType: s.participantType,
			participantId: s.participantId,
			shareAmount: s.shareAmount,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "ACCEPTED",
			verifiedAt: new Date(),
			rejectionReason: null,
			hasUnseenChanges: false,
		};
		db._stores.splits.set(spId, split);
	}
	return id;
}

describe("PeopleService.getPersonDetail — payer-or-split involvement", () => {
	let db: Db;
	const me = makeUserRef("me");
	const them = makeUserRef("them");

	beforeEach(() => {
		txSeq = 0;
		spSeq = 0;
		db = createStatefulDb();
		addUser(db, { id: "me", name: "Me" });
		addUser(db, { id: "them", name: "Them" });
	});

	it("shows a transaction where the other person paid the full amount for me and took no share", async () => {
		// Them paid 100 entirely for me. I owe the full amount; Them has NO split row.
		addTransaction(db, {
			paidBy: them,
			amount: 100,
			splits: [{ participantType: "user", participantId: "me", shareAmount: 100 }],
		});

		const service = new PeopleService(db as never, me);
		const detail = await service.getPersonDetail(them);

		expect(detail.transactions).toHaveLength(1);
		expect(detail.total).toBe(1);
		expect(detail.relationshipStats.transactionCount).toBe(1);

		// The transaction must be attributed to Them as the payer.
		const [tx] = detail.transactions;
		expect(tx?.paidBy.participantId).toBe("them");
		expect(tx?.myShare).toBe(100);
		expect(tx?.theirShare).toBe(0);
	});

	it("shows a transaction where I paid the full amount for them and took no share", async () => {
		// I paid 40 entirely for Them. Them owes the full amount; I have NO split row.
		addTransaction(db, {
			paidBy: me,
			amount: 40,
			splits: [
				{ participantType: "user", participantId: "them", shareAmount: 40 },
			],
		});

		const service = new PeopleService(db as never, me);
		const detail = await service.getPersonDetail(them);

		expect(detail.transactions).toHaveLength(1);
		expect(detail.total).toBe(1);
		const [tx] = detail.transactions;
		expect(tx?.paidBy.participantId).toBe("me");
		expect(tx?.myShare).toBe(0);
		expect(tx?.theirShare).toBe(40);
	});

	it("still shows normally-split transactions where both are split participants", async () => {
		addTransaction(db, {
			paidBy: me,
			amount: 50,
			splits: [
				{ participantType: "user", participantId: "me", shareAmount: 25 },
				{ participantType: "user", participantId: "them", shareAmount: 25 },
			],
		});

		const service = new PeopleService(db as never, me);
		const detail = await service.getPersonDetail(them);

		expect(detail.transactions).toHaveLength(1);
		expect(detail.total).toBe(1);
	});

	it("excludes transactions the other person is not involved in at all", async () => {
		// A third person paid for me only; Them is neither payer nor split participant.
		addUser(db, { id: "other", name: "Other" });
		addTransaction(db, {
			paidBy: makeUserRef("other"),
			amount: 100,
			splits: [{ participantType: "user", participantId: "me", shareAmount: 100 }],
		});

		// Ask for the person detail of "them" from my perspective:
		const meService = new PeopleService(db as never, me);
		const detail = await meService.getPersonDetail(them);

		expect(detail.transactions).toHaveLength(0);
		expect(detail.total).toBe(0);
	});

	it("counts both split and payer-only transactions together in the list and total", async () => {
		// Split transaction (both in splits) ...
		addTransaction(db, {
			paidBy: me,
			amount: 50,
			date: new Date("2026-01-02"),
			splits: [
				{ participantType: "user", participantId: "me", shareAmount: 25 },
				{ participantType: "user", participantId: "them", shareAmount: 25 },
			],
		});
		// ... plus a payer-only transaction (Them paid entirely for me).
		addTransaction(db, {
			paidBy: them,
			amount: 100,
			date: new Date("2026-01-03"),
			splits: [{ participantType: "user", participantId: "me", shareAmount: 100 }],
		});

		const service = new PeopleService(db as never, me);
		const detail = await service.getPersonDetail(them);

		expect(detail.total).toBe(2);
		expect(detail.transactions).toHaveLength(2);
		expect(detail.relationshipStats.transactionCount).toBe(2);
	});
});
