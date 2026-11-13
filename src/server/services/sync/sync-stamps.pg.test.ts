/**
 * The stamp trigger on real Postgres (E2EE lane P, P14a): what lands in
 * "sync_change" for each way a row of the nine synced tables is written,
 * changed or removed, as the app role (so the SECURITY DEFINER trigger is
 * what writes) and as the owner. Expectations are derived by hand from the
 * rows each test makes: one stamp per row, op U for a row that exists, D for
 * one that is gone.
 */

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	deleteAccount,
	deleteAccountIn,
} from "~/server/services/accounts/manage";
import {
	arsUser,
	isoDay,
	openAccount,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import { claimShadowProfile } from "~/server/services/claim.service";
import { ExpenseService } from "~/server/services/expense.service";
import { migrateGuestSessionsToUser } from "~/server/services/guest-migration.service";
import { commitImport } from "~/server/services/import/commit.mutation";
import { undoImport } from "~/server/services/import/undo.mutation";
import { addIncome } from "~/server/services/income/add.mutation";
import { deleteIncome } from "~/server/services/income/delete.mutation";
import { contactHashFor } from "~/server/services/keys/contact-hash";
import { forUser } from "~/server/services/preview";
import { deleteTemplate } from "~/server/services/recurring.service";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	DAY,
	describeStamps,
	seedPersonal,
	stampOf,
	stampsOf,
} from "./sync-test-support";

beforeAll(seedArsRates);

const asUser = <T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
) => userTransaction(adminDb, userId, work);

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("a row is stamped U when it is written", () => {
	it("one stamp per row in each of the nine tables, from an owner write and an app write", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const snapshots = ids(
			await adminDb.assetSnapshot.findMany({ where: { userId: user.id } }),
		);
		// By hand: 1 category, 1 template, 1 expense, 2 accounts, the day's
		// snapshot(s), 1 history, 1 rate type, 1 transfer, 1 leg.
		expect(describeStamps(await stampsOf(user.id))).toEqual(
			[
				`category:${s.category}:U`,
				`recurring_template:${s.template}:U`,
				`expense:${s.expense}:U`,
				`asset_account:${s.account}:U`,
				`asset_account:${s.other}:U`,
				...snapshots.map((id) => `asset_snapshot:${id}:U`),
				`asset_history:${s.history}:U`,
				`asset_rate_type:${s.rateType}:U`,
				`transfer:${s.transfer}:U`,
				`account_leg:${s.leg}:U`,
			].sort(),
		);

		// The app role has no INSERT on sync_change; the definer trigger writes.
		const id = await asUser(user.id, async (tx) => {
			const row = await tx.expense.create({
				data: {
					userId: user.id,
					title: "Tea",
					amount: "5",
					currency: "ARS",
					date: DAY,
					amountInUSD: "0.01",
					exchangeRate: "1468",
					pricingSource: "MANUAL",
				},
			});
			return row.id;
		});
		expect((await stampOf(user.id, "expense", id))?.op).toBe("U");
	});

	it("a bulk insert of 10,000 rows writes 10,000 stamps in one transaction, and deleting the user takes them all", async () => {
		const { user } = await createTestUser();
		const base = {
			userId: user.id,
			title: "Row",
			amount: "1",
			currency: "ARS",
			date: DAY,
			amountInUSD: "0.01",
			exchangeRate: "1468",
			pricingSource: "IMPORT",
		};
		await fixtureDb.expense.createMany({
			data: Array.from({ length: 10_000 }, () => base),
		});
		const rows = await stampsOf(user.id, "expense");
		expect(rows).toHaveLength(10_000);
		expect(new Set(rows.map((r) => r.op))).toEqual(new Set(["U"]));
		// One statement, one transaction: one txid, 10,000 distinct seqs.
		expect(new Set(rows.map((r) => r.txid)).size).toBe(1);
		expect(new Set(rows.map((r) => r.seq)).size).toBe(10_000);

		await adminDb.user.delete({ where: { id: user.id } });
		expect(await stampsOf(user.id)).toEqual([]);
	}, 60_000);
});

describe("a row is stamped D on every delete path", () => {
	it("expense.service delete of an amortized parent: the children and the parent", async () => {
		const { user, db } = await createTestUser();
		const parent = await fixtureDb.expense.create({
			data: {
				userId: user.id,
				title: "Laptop",
				amount: "1200",
				currency: "ARS",
				date: DAY,
				amountInUSD: "0.8",
				exchangeRate: "1468",
				pricingSource: "MANUAL",
				isAmortizedParent: true,
			},
		});
		const child = await fixtureDb.expense.create({
			data: {
				userId: user.id,
				title: "Laptop 1/2",
				amount: "600",
				currency: "ARS",
				date: DAY,
				amountInUSD: "0.4",
				exchangeRate: "1468",
				pricingSource: "MANUAL",
				isAmortizedChild: true,
				parentId: parent.id,
			},
		});
		await new ExpenseService(db).deleteExpense(user.id, parent.id);
		expect(describeStamps(await stampsOf(user.id))).toEqual(
			[`expense:${parent.id}:D`, `expense:${child.id}:D`].sort(),
		);
	});

	it("the FK cascade alone: deleting an amortized parent takes its child with it", async () => {
		const { user } = await createTestUser();
		const base = {
			userId: user.id,
			amount: "10",
			currency: "ARS",
			date: DAY,
			amountInUSD: "0.01",
			exchangeRate: "1468",
			pricingSource: "MANUAL",
		};
		const parent = await fixtureDb.expense.create({
			data: { ...base, title: "P", isAmortizedParent: true },
		});
		const child = await fixtureDb.expense.create({
			data: {
				...base,
				title: "C",
				isAmortizedChild: true,
				parentId: parent.id,
			},
		});
		await adminDb.expense.delete({ where: { id: parent.id } });
		expect(await stampOf(user.id, "expense", child.id)).toMatchObject({
			op: "D",
		});
		expect(await stampOf(user.id, "expense", parent.id)).toMatchObject({
			op: "D",
		});
	});

	it("income.delete: the money in row, its template and its leg", async () => {
		const { user } = await arsUser();
		const savings = await openAccount(user.id, "Savings", "CASH", "ARS", 5000);
		const { value } = await forUser(user.id).apply(addIncome, {
			title: "Salary",
			amount: "1000",
			currency: "ARS",
			into: savings,
			repeats: { frequency: "MONTHLY" },
		});
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { expenseId: value.expenseId },
		});
		expect((await stampOf(user.id, "account_leg", leg.id))?.op).toBe("U");
		await forUser(user.id).apply(deleteIncome, {
			expenseId: value.expenseId,
			templateId: value.templateId,
		});
		expect(
			(await stampOf(user.id, "expense", value.expenseId as string))?.op,
		).toBe("D");
		expect(
			(await stampOf(user.id, "recurring_template", value.templateId as string))
				?.op,
		).toBe("D");
		expect((await stampOf(user.id, "account_leg", leg.id))?.op).toBe("D");
		// The balance went back, and the account is stamped as changed, not gone.
		expect((await stampOf(user.id, "asset_account", savings))?.op).toBe("U");
	});

	it("transfer.delete: the transfer, both legs and the fee expense", async () => {
		const { user } = await arsUser();
		const from = await openAccount(user.id, "Savings", "CASH", "ARS", 5000);
		const to = await openAccount(user.id, "Wallet", "CASH", "ARS", 1000);
		const made = await forUser(user.id).apply(createTransfer, {
			fromAccountId: from,
			toAccountId: to,
			fromAmount: "300",
			fee: { amount: "15" },
		});
		const transferId = made.value.transferId;
		const legs = await adminDb.accountLeg.findMany({
			where: { userId: user.id, transferId },
		});
		const fee = await adminDb.transfer.findUniqueOrThrow({
			where: { id: transferId },
			select: { feeExpenseId: true },
		});
		expect(legs.length).toBeGreaterThanOrEqual(2);
		await forUser(user.id).apply(deleteTransfer, { transferId });
		expect((await stampOf(user.id, "transfer", transferId))?.op).toBe("D");
		for (const leg of legs)
			expect((await stampOf(user.id, "account_leg", leg.id))?.op).toBe("D");
		expect(fee.feeExpenseId).not.toBeNull();
		expect(
			(await stampOf(user.id, "expense", fee.feeExpenseId as string))?.op,
		).toBe("D");
	});

	it("import.undo: the batch's expenses, in one statement", async () => {
		const { user } = await arsUser();
		const row = (title: string, amount: number) => ({
			title,
			amount,
			currency: "ARS",
			date: isoDay(TODAY),
			location: "",
			description: "",
			pricingSource: "IMPORT",
			category: "",
		});
		const job = await fixtureDb.importJob.create({
			data: {
				userId: user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "x.csv",
				fileSize: 10,
				fileType: "csv",
				transactions: [
					row("A", 10),
					row("B", 20),
				] as unknown as Prisma.InputJsonValue,
				warnings: [],
				totalTransactions: 2,
			},
		});
		await forUser(user.id).apply(commitImport, {
			jobId: job.id,
			rows: [0, 1].map((index) => ({
				index,
				keep: true,
				categoryId: null,
				kind: "expense" as const,
			})),
		});
		const made = await adminDb.expense.findMany({
			where: { userId: user.id, pricingSource: "IMPORT" },
		});
		expect(made).toHaveLength(2);
		expect(
			new Set((await stampsOf(user.id, "expense")).map((s) => s.op)),
		).toEqual(new Set(["U"]));
		await forUser(user.id).apply(undoImport, { jobId: job.id });
		const after = await stampsOf(user.id, "expense");
		expect(describeStamps(after)).toEqual(
			made.map((m) => `expense:${m.id}:D`).sort(),
		);
		// One deleteMany: one txid.
		expect(new Set(after.map((s) => s.txid)).size).toBe(1);
	});

	it("accounts.delete: the account and everything under it", async () => {
		const { user } = await arsUser();
		const account = await openAccount(user.id, "Old", "CASH", "ARS", 100);
		const history = await fixtureDb.assetHistory.create({
			data: { assetId: account, userId: user.id, balance: "100" },
		});
		const rateType = await fixtureDb.assetRateType.create({
			data: { userId: user.id, accountId: account, from: DAY, type: "blue" },
		});
		const snapshots = ids(
			await adminDb.assetSnapshot.findMany({ where: { accountId: account } }),
		);
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
		await deleteAccount(adminDb, user.id, account);
		expect((await stampOf(user.id, "asset_account", account))?.op).toBe("D");
		expect((await stampOf(user.id, "asset_history", history.id))?.op).toBe("D");
		expect((await stampOf(user.id, "asset_rate_type", rateType.id))?.op).toBe(
			"D",
		);
		for (const id of snapshots)
			expect((await stampOf(user.id, "asset_snapshot", id))?.op).toBe("D");
	});

	it("deleteAccountIn inside an app transaction and a leg deleteMany (the ledger's reverseLegs)", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		await asUser(user.id, async (tx) => {
			await tx.accountLeg.deleteMany({ where: { id: { in: [s.leg] } } });
			await deleteAccountIn(tx, user.id, s.other);
		});
		expect((await stampOf(user.id, "account_leg", s.leg))?.op).toBe("D");
		expect((await stampOf(user.id, "asset_account", s.other))?.op).toBe("D");
		// The transfer pointed at it: SET NULL, so the transfer is changed, not gone.
		expect((await stampOf(user.id, "transfer", s.transfer))?.op).toBe("U");
	});

	it("recurring.service delete and the router's deleteMany", async () => {
		const { user, db } = await createTestUser();
		const a = await fixtureDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "A",
				amount: "1",
				frequency: "MONTHLY",
				nextDueDate: DAY,
			},
		});
		const b = await fixtureDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "B",
				amount: "1",
				frequency: "MONTHLY",
				nextDueDate: DAY,
			},
		});
		await deleteTemplate(db, user.id, a.id);
		await db.recurringTemplate.deleteMany({
			where: { id: b.id, userId: user.id },
		});
		expect((await stampOf(user.id, "recurring_template", a.id))?.op).toBe("D");
		expect((await stampOf(user.id, "recurring_template", b.id))?.op).toBe("D");
	});
});

describe("a change no service made", () => {
	it("FK SET NULL: deleting a category changes its expenses (updatedAt does not move)", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const before = await stampOf(user.id, "expense", s.expense);
		const stamped = await adminDb.expense.findUniqueOrThrow({
			where: { id: s.expense },
			select: { updatedAt: true },
		});
		await adminDb.category.delete({ where: { id: s.category } });
		const after = await stampOf(user.id, "expense", s.expense);
		expect(after?.op).toBe("U");
		expect(BigInt(after?.seq ?? 0)).toBeGreaterThan(BigInt(before?.seq ?? 0));
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: s.expense },
			select: { categoryId: true, updatedAt: true },
		});
		expect(row.categoryId).toBeNull();
		expect(row.updatedAt).toEqual(stamped.updatedAt);
		expect((await stampOf(user.id, "category", s.category))?.op).toBe("D");
	});

	it("FK SET NULL: deleting a template changes the expenses it made", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const before = await stampOf(user.id, "expense", s.expense);
		await adminDb.recurringTemplate.delete({ where: { id: s.template } });
		const after = await stampOf(user.id, "expense", s.expense);
		expect(BigInt(after?.seq ?? 0)).toBeGreaterThan(BigInt(before?.seq ?? 0));
	});

	it("the balance trigger: a leg insert stamps the account and its snapshot in the leg's transaction", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const snapshots = await adminDb.assetSnapshot.findMany({
			where: { accountId: s.account },
		});
		const accountBefore = await stampOf(user.id, "asset_account", s.account);
		const snapshotBefore = await stampOf(
			user.id,
			"asset_snapshot",
			snapshots[0]?.id as string,
		);
		const legId = await asUser(user.id, async (tx) => {
			const leg = await tx.accountLeg.create({
				data: {
					userId: user.id,
					accountId: s.account,
					currency: "ARS",
					amount: "25",
					date: DAY,
					source: "TRANSFER",
					transferId: s.transfer,
					// Before the snapshot was recorded, so the trigger moves it too.
					createdAt: new Date("2026-10-01T00:00:00.000Z"),
				},
			});
			return leg.id;
		});
		const leg = await stampOf(user.id, "account_leg", legId);
		const account = await stampOf(user.id, "asset_account", s.account);
		const snapshot = await stampOf(
			user.id,
			"asset_snapshot",
			snapshots[0]?.id as string,
		);
		expect(BigInt(account?.seq ?? 0)).toBeGreaterThan(
			BigInt(accountBefore?.seq ?? 0),
		);
		expect(BigInt(snapshot?.seq ?? 0)).toBeGreaterThan(
			BigInt(snapshotBefore?.seq ?? 0),
		);
		// One transaction wrote all three, so they share a txid.
		expect(new Set([leg?.txid, account?.txid, snapshot?.txid]).size).toBe(1);
		// The balance really moved: 1000 - 50 (seed leg) + 25.
		const row = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id: s.account },
			select: { balance: true },
		});
		expect(row.balance.toString()).toBe("975");
	});

	it("an UPDATE that changes the owner stamps D for the old owner and U for the new one, and back", async () => {
		const a = await createTestUser();
		const b = await createTestUser();
		const s = await seedPersonal(a.user.id);
		await adminDb.$executeRaw`UPDATE "expense" SET "userId" = ${b.user.id} WHERE "id" = ${s.expense}`;
		expect((await stampOf(a.user.id, "expense", s.expense))?.op).toBe("D");
		expect((await stampOf(b.user.id, "expense", s.expense))?.op).toBe("U");
		await adminDb.$executeRaw`UPDATE "expense" SET "userId" = ${a.user.id} WHERE "id" = ${s.expense}`;
		expect((await stampOf(a.user.id, "expense", s.expense))?.op).toBe("U");
		expect((await stampOf(b.user.id, "expense", s.expense))?.op).toBe("D");
	});

	it("an UPDATE that changes the id tombstones the old id", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const next = randomUUID();
		await adminDb.$executeRaw`UPDATE "recurring_template" SET "id" = ${next} WHERE "id" = ${s.template}`;
		expect((await stampOf(user.id, "recurring_template", s.template))?.op).toBe(
			"D",
		);
		expect((await stampOf(user.id, "recurring_template", next))?.op).toBe("U");
	});
});

describe("stamp churn", () => {
	it("a row written twice in one transaction keeps its first stamp; the next transaction restamps it", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		await asUser(user.id, async (tx) => {
			await tx.expense.update({
				where: { id: s.expense },
				data: { amount: "11" },
			});
			const [first] = await tx.$queryRaw<{ seq: string }[]>`
				SELECT "seq"::text AS "seq" FROM "sync_change"
				WHERE "entity" = 'expense' AND "entityId" = ${s.expense}`;
			await tx.expense.update({
				where: { id: s.expense },
				data: { amount: "12" },
			});
			const [second] = await tx.$queryRaw<{ seq: string }[]>`
				SELECT "seq"::text AS "seq" FROM "sync_change"
				WHERE "entity" = 'expense' AND "entityId" = ${s.expense}`;
			expect(second?.seq).toBe(first?.seq);
		});
		const mid = await stampOf(user.id, "expense", s.expense);
		await adminDb.expense.update({
			where: { id: s.expense },
			data: { amount: "13" },
		});
		const last = await stampOf(user.id, "expense", s.expense);
		expect(BigInt(last?.seq ?? 0)).toBeGreaterThan(BigInt(mid?.seq ?? 0));
		expect(last?.txid).not.toBe(mid?.txid);
	});

	it("insert then delete in one transaction ends as D", async () => {
		const { user } = await createTestUser();
		const id = await asUser(user.id, async (tx) => {
			const row = await tx.expense.create({
				data: {
					userId: user.id,
					title: "Gone",
					amount: "1",
					currency: "ARS",
					date: DAY,
					amountInUSD: "0.01",
					exchangeRate: "1468",
					pricingSource: "MANUAL",
				},
			});
			await tx.expense.delete({ where: { id: row.id } });
			return row.id;
		});
		expect((await stampOf(user.id, "expense", id))?.op).toBe("D");
	});

	it("an undo that puts a deleted row back with the same id turns D into U", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: s.expense },
		});
		await adminDb.expense.delete({ where: { id: s.expense } });
		expect((await stampOf(user.id, "expense", s.expense))?.op).toBe("D");
		await fixtureDb.expense.create({
			data: { ...row, categoryId: null, recurringTemplateId: null },
		});
		expect((await stampOf(user.id, "expense", s.expense))?.op).toBe("U");
	});
});

describe("a write that does not commit leaves no stamp", () => {
	it("a rolled-back transaction", async () => {
		const { user } = await createTestUser();
		const id = randomUUID();
		await expect(
			asUser(user.id, async (tx) => {
				await tx.expense.create({
					data: {
						id,
						userId: user.id,
						title: "Never",
						amount: "1",
						currency: "ARS",
						date: DAY,
						amountInUSD: "0.01",
						exchangeRate: "1468",
						pricingSource: "MANUAL",
					},
				});
				expect((await stampOf(user.id, "expense", id))?.op).toBeUndefined();
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(await stampOf(user.id, "expense", id)).toBeUndefined();
	});

	it("a money preview, which is a rolled-back write", async () => {
		const { user } = await arsUser();
		const from = await openAccount(user.id, "Savings", "CASH", "ARS", 5000);
		const to = await openAccount(user.id, "Wallet", "CASH", "ARS", 1000);
		const before = describeStamps(await stampsOf(user.id));
		const seqs = (await stampsOf(user.id)).map((s) => s.seq).sort();
		const preview = await forUser(user.id).preview(createTransfer, {
			fromAccountId: from,
			toAccountId: to,
			fromAmount: "300",
			fee: { amount: "15" },
		});
		expect(preview.changes.length).toBeGreaterThan(0);
		expect(describeStamps(await stampsOf(user.id))).toEqual(before);
		expect((await stampsOf(user.id)).map((s) => s.seq).sort()).toEqual(seqs);
	});
});

describe("accounts and guests", () => {
	it("deleting the user leaves no stamps of theirs, fails nothing, and keeps other users' stamps", async () => {
		const gone = await createTestUser();
		const stays = await createTestUser();
		await seedPersonal(gone.user.id);
		const kept = await seedPersonal(stays.user.id);
		expect((await stampsOf(gone.user.id)).length).toBeGreaterThan(0);
		await anonymizeAndDeleteUser(adminDb, gone.user.id, gone.user.email, null);
		expect(await stampsOf(gone.user.id)).toEqual([]);
		expect((await stampOf(stays.user.id, "expense", kept.expense))?.op).toBe(
			"U",
		);
	});

	it("a stamp holds ids and counters only, no text", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		const columns = await adminDb.$queryRaw<{ column_name: string }[]>`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = 'sync_change' ORDER BY column_name`;
		expect(columns.map((c) => c.column_name)).toEqual([
			"changedAt",
			"entity",
			"entityId",
			"op",
			"seq",
			"txid",
			"userId",
		]);
		const text = JSON.stringify(await stampsOf(user.id));
		for (const word of ["Coffee", "Rent", "Cash", "Savings", "Food"])
			expect(text).not.toContain(word);
	});

	it("claiming a ghost and migrating a guest write personal stamps for nobody (they write shared rows only)", async () => {
		const sofia = await createTestUser();
		const claimer = await createTestUser();
		const migrated = await createTestUser();
		const shadow = await adminDb.shadowProfile.create({
			data: { createdById: sofia.user.id, name: "Paz" },
		});
		const project = await adminDb.project.create({
			data: { name: "Trip", createdById: sofia.user.id },
		});
		const email = `${randomUUID()}@pg-test.invalid`;
		const session = await adminDb.guestSession.create({
			data: {
				name: "Guest",
				email,
				emailHash: await contactHashFor("guest_session", email),
				magicLinkId: randomUUID(),
				projectId: project.id,
				sessionToken: randomUUID(),
			},
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "guest",
				participantId: session.id,
				role: "CONTRIBUTOR",
			},
		});
		const all = async () =>
			adminDb.syncChange.count({
				where: {
					userId: { in: [sofia.user.id, claimer.user.id, migrated.user.id] },
				},
			});
		const before = await all();
		await claimShadowProfile(adminDb, shadow.id, claimer.user.id);
		await migrateGuestSessionsToUser(adminDb, migrated.user.id, email);
		expect(await all()).toBe(before);
		expect(before).toBe(0);
	});
});
