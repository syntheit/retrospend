/**
 * Fixtures for the sync pg tests (E2EE lane P, P14a): one user with a row in
 * each of the nine synced tables, the stamps read straight from "sync_change"
 * as the owner, and a poll for the commit-order cut (a stamp shows only once
 * every older transaction in the cluster has finished, so a read right after
 * a commit may legitimately come back short).
 */
import type { SyncEntity } from "~/server/services/sync/entities";
import { adminDb, fixtureDb, fixtureNameIndex } from "~/test/pg-harness";

export type StampRow = {
	entity: string;
	entityId: string;
	userId: string;
	op: string;
	txid: string;
	seq: string;
};

/** The stamps of one user, optionally of one entity, by entity and id. */
export async function stampsOf(
	userId: string,
	entity?: SyncEntity,
): Promise<StampRow[]> {
	return adminDb.$queryRaw<StampRow[]>`
		SELECT "entity", "entityId", "userId", "op", "txid"::text AS "txid", "seq"::text AS "seq"
		FROM "sync_change"
		WHERE "userId" = ${userId} AND (${entity ?? null}::text IS NULL OR "entity" = ${entity ?? null})
		ORDER BY "entity", "entityId", "userId"`;
}

/** The stamp of one id, or undefined. */
export async function stampOf(
	userId: string,
	entity: SyncEntity,
	id: string,
): Promise<StampRow | undefined> {
	return (await stampsOf(userId, entity)).find((s) => s.entityId === id);
}

/** `entity:id:op` for each stamp, sorted: a readable whole-state assertion. */
export function describeStamps(rows: StampRow[]): string[] {
	return rows.map((s) => `${s.entity}:${s.entityId}:${s.op}`).sort();
}

export const DAY = new Date("2026-10-05T00:00:00.000Z");

/**
 * One row in every synced table for `userId`, linked the way the app links
 * them: the expense is in the category, from the template and has a leg in the
 * account; the transfer moves between two accounts. The leg's trigger moves
 * the account's balance and its day's snapshot. Ids come back by name.
 */
export async function seedPersonal(userId: string) {
	const tag = userId.slice(0, 8);
	const categoryName = `Food ${tag}`;
	const category = await fixtureDb.category.create({
		data: {
			userId,
			name: categoryName,
			color: "emerald",
			nameIndex: await fixtureNameIndex(userId, categoryName),
		},
	});
	const template = await fixtureDb.recurringTemplate.create({
		data: {
			userId,
			name: "Rent",
			amount: "100",
			currency: "ARS",
			frequency: "MONTHLY",
			nextDueDate: DAY,
		},
	});
	const expense = await fixtureDb.expense.create({
		data: {
			userId,
			title: "Coffee",
			amount: "100",
			currency: "ARS",
			date: DAY,
			amountInUSD: "0.07",
			exchangeRate: "1468",
			pricingSource: "MANUAL",
			categoryId: category.id,
			recurringTemplateId: template.id,
		},
	});
	const account = await fixtureDb.assetAccount.create({
		data: {
			userId,
			name: "Cash",
			type: "CASH",
			currency: "ARS",
			balance: "1000",
		},
	});
	const other = await fixtureDb.assetAccount.create({
		data: {
			userId,
			name: "Savings",
			type: "CASH",
			currency: "ARS",
			balance: "500",
		},
	});
	const snapshot = await fixtureDb.assetSnapshot.create({
		data: {
			accountId: account.id,
			userId,
			date: DAY,
			balance: "1000",
			balanceInUSD: "0.68",
		},
	});
	const history = await fixtureDb.assetHistory.create({
		data: { assetId: account.id, userId, balance: "1000" },
	});
	const rateType = await fixtureDb.assetRateType.create({
		data: { userId, accountId: account.id, from: DAY, type: "blue" },
	});
	const transfer = await fixtureDb.transfer.create({
		data: {
			userId,
			kind: "TRANSFER",
			date: DAY,
			fromAccountId: account.id,
			fromAmount: "50",
			fromCurrency: "ARS",
			toAccountId: other.id,
			toAmount: "50",
			toCurrency: "ARS",
		},
	});
	const leg = await fixtureDb.accountLeg.create({
		data: {
			userId,
			accountId: account.id,
			currency: "ARS",
			amount: "-50",
			date: DAY,
			source: "TRANSFER",
			transferId: transfer.id,
		},
	});
	return {
		category: category.id,
		template: template.id,
		expense: expense.id,
		account: account.id,
		other: other.id,
		snapshot: snapshot.id,
		history: history.id,
		rateType: rateType.id,
		transfer: transfer.id,
		leg: leg.id,
	};
}

/**
 * Calls `read` until `done` accepts its result (the cut moves with other
 * transactions), at most `ms`. The deadline runs on performance.now(), which
 * a faked Date never moves, so a test that fakes the clock around a read does
 * not hang this loop.
 */
export async function until<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	ms = 15_000,
): Promise<T> {
	const stop = performance.now() + ms;
	for (;;) {
		const value = await read();
		if (done(value) || performance.now() > stop) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
