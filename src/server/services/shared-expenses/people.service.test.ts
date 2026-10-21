import { beforeEach, describe, expect, it, vi } from "vitest";

// PeopleService imports ~/server/storage (getImageUrl), which transitively
// imports src/env.js (t3-env) and requires DATABASE_URL etc. Mock it so the
// service can be exercised with the in-memory stateful DB alone.
vi.mock("~/server/storage", () => ({
	getImageUrl: (path: string | null) => path,
}));

import {
	addProject,
	addProjectParticipant,
	addShadowProfile,
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
		projectId?: string | null;
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
		projectId: opts.projectId ?? null,
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

describe("PeopleService person detail: per-project balances", () => {
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

	function addSettlement(projectId: string | null, amount: number) {
		db._stores.settlements.set(`st-${db._stores.settlements.size + 1}`, {
			id: `st-${db._stores.settlements.size + 1}`,
			fromParticipantType: "user",
			fromParticipantId: "them",
			toParticipantType: "user",
			toParticipantId: "me",
			amount,
			currency: "USD",
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
			initiatedAt: new Date(),
			settledAt: new Date(),
			convertedAmount: null,
			convertedCurrency: null,
			exchangeRateUsed: null,
			paymentMethod: null,
			note: null,
			projectId,
		});
	}

	it("subtracts each project's settlements from its pill and keeps the header total", async () => {
		const trip = addProject(db, { createdById: "me", name: "Trip" });
		const flat = addProject(db, { createdById: "me", name: "Flat" });
		// Them owes me 40 in Trip and 10 in Flat.
		addTransaction(db, {
			paidBy: me,
			amount: 40,
			projectId: trip.id,
			splits: [{ participantType: "user", participantId: "them", shareAmount: 40 }],
		});
		addTransaction(db, {
			paidBy: me,
			amount: 10,
			projectId: flat.id,
			splits: [{ participantType: "user", participantId: "them", shareAmount: 10 }],
		});
		// Them settled Trip in full.
		addSettlement(trip.id, 40);

		const service = new PeopleService(db as never, me);
		for (const detail of [
			await service.getPersonDetail(them),
			await service.getPersonDetailCursor(them),
		]) {
			const byId = new Map(
				(detail.projectBreakdown ?? []).map((p) => [p.projectId, p]),
			);
			expect(byId.get(trip.id)?.balances).toEqual([]);
			expect(byId.get(flat.id)?.balances).toEqual([
				{ balance: 10, currency: "USD", direction: "they_owe_you" },
			]);
			expect(detail.balances).toEqual([
				{ balance: 10, currency: "USD", direction: "they_owe_you" },
			]);
		}
	});

	it("shows a direct settlement without direct expenses as its own bucket", async () => {
		const trip = addProject(db, { createdById: "me", name: "Trip" });
		addTransaction(db, {
			paidBy: me,
			amount: 40,
			projectId: trip.id,
			splits: [{ participantType: "user", participantId: "them", shareAmount: 40 }],
		});
		// A project-less settle-up (recorded before settlements were scoped).
		addSettlement(null, 40);

		const service = new PeopleService(db as never, me);
		const detail = await service.getPersonDetail(them);
		const byId = new Map(detail.projectBreakdown.map((p) => [p.projectId, p]));

		expect(detail.balances).toEqual([]);
		expect(byId.get(trip.id)?.balances).toEqual([
			{ balance: 40, currency: "USD", direction: "they_owe_you" },
		]);
		expect(byId.get(null)?.balances).toEqual([
			{ balance: 40, currency: "USD", direction: "you_owe_them" },
		]);
	});
});

describe("PeopleService identity contact details", () => {
	let db: Db;
	let projectId: string;
	let ghostId: string;
	const owner = makeUserRef("owner");
	const viewer = makeUserRef("viewer");
	const guest = { participantType: "guest" as const, participantId: "guest-1" };

	beforeEach(() => {
		txSeq = 0;
		spSeq = 0;
		db = createStatefulDb();
		addUser(db, { id: "owner", name: "Owner" });
		addUser(db, { id: "viewer", name: "Viewer" });
		projectId = addProject(db, { createdById: "owner" }).id;
		ghostId = addShadowProfile(db, {
			createdById: "owner",
			name: "Ghost",
			email: "ghost@example.com",
			phone: "+100",
		}).id;
		db._stores.guestSessions.set("guest-1", {
			id: "guest-1",
			name: "Guest",
			email: "guest@example.com",
			magicLinkId: "link-1",
			projectId,
			sessionToken: "x",
			lastActiveAt: new Date(),
			createdAt: new Date(),
		});
		for (const [type, id, role] of [
			["user", "owner", "ORGANIZER"],
			["user", "viewer", "VIEWER"],
			["guest", "guest-1", "CONTRIBUTOR"],
			["shadow", ghostId, "CONTRIBUTOR"],
		] as const) {
			addProjectParticipant(db, {
				projectId,
				participantType: type,
				participantId: id,
				role,
			});
		}
		addTransaction(db, {
			paidBy: owner,
			amount: 40,
			projectId,
			splits: [
				{ participantType: "user", participantId: "owner", shareAmount: 10 },
				{ participantType: "user", participantId: "viewer", shareAmount: 10 },
				{ participantType: "guest", participantId: "guest-1", shareAmount: 10 },
				{ participantType: "shadow", participantId: ghostId, shareAmount: 10 },
			],
		});
	});

	const ghost = () => ({ participantType: "shadow" as const, participantId: ghostId });

	it("a VIEWER sharing an expense sees no ghost email or phone", async () => {
		const detail = await new PeopleService(db as never, viewer).getPersonDetail(
			ghost(),
		);
		expect(detail.identity.email).toBeNull();
		expect(detail.identity.phone).toBeNull();
	});

	it("a VIEWER's people list has no ghost or guest emails", async () => {
		const people = await new PeopleService(db as never, viewer).listPeople();
		expect(people.length).toBeGreaterThan(0);
		for (const p of people) expect(p.identity.email).toBeNull();
	});

	it("a contributing guest sees no ghost email", async () => {
		const detail = await new PeopleService(db as never, guest).getPersonDetail(
			ghost(),
			{ projectId },
		);
		expect(detail.identity.email).toBeNull();
		expect(detail.identity.phone).toBeNull();
	});

	it("the ghost's organizer sees ghost and guest contact details", async () => {
		const service = new PeopleService(db as never, owner);
		const ghostDetail = await service.getPersonDetail(ghost());
		expect(ghostDetail.identity.email).toBe("ghost@example.com");
		expect(ghostDetail.identity.phone).toBe("+100");

		const guestDetail = await service.getPersonDetail(guest);
		expect(guestDetail.identity.email).toBe("guest@example.com");
	});
});
