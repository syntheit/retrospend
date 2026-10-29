/**
 * An account and its whole history as stored, for the undo of its delete. The
 * delete cascades the account's balances over time, its legs, its rate-type
 * switches and its balance history away, and detaches what points at it (the
 * moves it was one side of, the budget's wealth moves, the envelopes that
 * track it). All of that is kept: every column comes back as it was, and the
 * rows that pointed at it are pointed at it again. Decimals and dates are
 * tagged so JSON keeps them exact (entry/row-pack.ts).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { packRow, type Row, unpackRow } from "../entry/row-pack";

type Tx = Prisma.TransactionClient;

export interface AccountSnapshot {
	readonly userId: string;
	readonly account: Row;
	readonly snapshots: readonly Row[];
	readonly history: readonly Row[];
	readonly rateTypes: readonly Row[];
	readonly legs: readonly Row[];
	/**
	 * How each expense and move a leg belongs to looked when the account was
	 * deleted, so an undo can tell one that was edited since (the leg would then
	 * disagree with it). Absent on a stash written before this was kept.
	 */
	readonly sources?: {
		readonly expenses: readonly ExpenseStamp[];
		readonly transfers: readonly TransferStamp[];
	};
	/** Rows that pointed at the account and were detached by the delete. */
	readonly links: {
		readonly transfersFrom: readonly string[];
		readonly transfersTo: readonly string[];
		/**
		 * The budget's side of a move, whole: the app role may add and remove
		 * these but never edit one, so it is put back by removing and adding it.
		 * Only your own (the policy lets you write only your own).
		 */
		readonly wealthTransfers: readonly Row[];
		readonly liabilityEnvelopes: readonly string[];
		readonly wealthEnvelopes: readonly string[];
	};
}

interface ExpenseStamp {
	readonly id: string;
	readonly amount: string;
	readonly currency: string;
	readonly date: string;
	readonly updatedAt: string;
}

interface TransferStamp {
	readonly id: string;
	readonly fromAmount: string;
	readonly fromCurrency: string;
	readonly toAmount: string;
	readonly toCurrency: string;
	readonly date: string;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

export async function snapshotAccount(
	tx: Tx,
	userId: string,
	id: string,
): Promise<AccountSnapshot> {
	const row = await tx.assetAccount.findFirst({
		where: { id, userId },
		include: { snapshots: true, history: true, rateTypes: true, legs: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
	}
	const { snapshots, history, rateTypes, legs, ...account } = row;
	const [from, to, wealth, liability, goal] = await Promise.all([
		tx.transfer.findMany({
			where: { fromAccountId: id },
			select: { id: true },
		}),
		tx.transfer.findMany({ where: { toAccountId: id }, select: { id: true } }),
		tx.wealthTransfer.findMany({
			where: { assetAccountId: id, actorUserId: userId },
		}),
		tx.envelope.findMany({
			where: { targetLiabilityId: id },
			select: { id: true },
		}),
		tx.envelope.findMany({
			where: { wealthAccountId: id },
			select: { id: true },
		}),
	]);
	const expenseIds = [
		...new Set(legs.map((l) => l.expenseId).filter((v): v is string => !!v)),
	];
	const transferIds = [
		...new Set(legs.map((l) => l.transferId).filter((v): v is string => !!v)),
	];
	const [expenseRows, transferRows] = await Promise.all([
		tx.expense.findMany({
			where: { id: { in: expenseIds } },
			select: {
				id: true,
				amount: true,
				currency: true,
				date: true,
				updatedAt: true,
			},
		}),
		tx.transfer.findMany({
			where: { id: { in: transferIds } },
			select: {
				id: true,
				fromAmount: true,
				fromCurrency: true,
				toAmount: true,
				toCurrency: true,
				date: true,
			},
		}),
	]);
	return {
		userId,
		sources: {
			expenses: expenseRows.map(expenseStamp),
			transfers: transferRows.map(transferStamp),
		},
		account: packRow(account),
		snapshots: snapshots.map(packRow),
		history: history.map(packRow),
		rateTypes: rateTypes.map(packRow),
		legs: legs.map(packRow),
		links: {
			transfersFrom: ids(from),
			transfersTo: ids(to),
			wealthTransfers: wealth.map(packRow),
			liabilityEnvelopes: ids(liability),
			wealthEnvelopes: ids(goal),
		},
	};
}

type ExpenseSource = {
	id: string;
	amount: { toString(): string };
	currency: string;
	date: Date;
	updatedAt: Date;
};
type TransferSource = {
	id: string;
	fromAmount: { toString(): string };
	fromCurrency: string;
	toAmount: { toString(): string };
	toCurrency: string;
	date: Date;
};

const expenseStamp = (e: ExpenseSource): ExpenseStamp => ({
	id: e.id,
	amount: e.amount.toString(),
	currency: e.currency,
	date: e.date.toISOString(),
	updatedAt: e.updatedAt.toISOString(),
});

const transferStamp = (t: TransferSource): TransferStamp => ({
	id: t.id,
	fromAmount: t.fromAmount.toString(),
	fromCurrency: t.fromCurrency,
	toAmount: t.toAmount.toString(),
	toCurrency: t.toCurrency,
	date: t.date.toISOString(),
});

const same = <T extends object>(a: T, b: T) =>
	JSON.stringify(a) === JSON.stringify(b);

const changed = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This account changed since. Undo is no longer safe.",
	});

/**
 * Puts the account back as it was stored. Refused (a conflict) when it is back
 * already, or when a move or expense one of its legs belongs to is gone since:
 * that leg could not be put back, and the balance would not add up.
 */
export async function restoreAccount(
	tx: Tx,
	userId: string,
	snapshot: AccountSnapshot,
): Promise<string> {
	const account = unpackRow(
		snapshot.account,
	) as unknown as Prisma.AssetAccountUncheckedCreateInput;
	if (snapshot.userId !== userId || account.userId !== userId) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Asset not found" });
	}
	const id = account.id as string;
	const there = await tx.assetAccount.findUnique({
		where: { id },
		select: { id: true },
	});
	if (there) throw changed();

	const legs = snapshot.legs.map(
		(l) => unpackRow(l) as unknown as Prisma.AccountLegUncheckedCreateInput,
	);
	const transferIds = [
		...new Set(legs.map((l) => l.transferId).filter((v): v is string => !!v)),
	];
	const expenseIds = [
		...new Set(legs.map((l) => l.expenseId).filter((v): v is string => !!v)),
	];
	const [transfers, expenses] = await Promise.all([
		tx.transfer.findMany({ where: { id: { in: transferIds } } }),
		tx.expense.findMany({ where: { id: { in: expenseIds } } }),
	]);
	if (
		transfers.length !== transferIds.length ||
		expenses.length !== expenseIds.length
	)
		throw changed();
	// One edited since (amount, currency or day) no longer matches its leg.
	const was = snapshot.sources;
	if (was) {
		const nowExpense = new Map(expenses.map((e) => [e.id, expenseStamp(e)]));
		const nowTransfer = new Map(transfers.map((t) => [t.id, transferStamp(t)]));
		for (const e of was.expenses) {
			const now = nowExpense.get(e.id);
			if (!now || !same(now, e)) throw changed();
		}
		for (const t of was.transfers) {
			const now = nowTransfer.get(t.id);
			if (!now || !same(now, t)) throw changed();
		}
	}

	await tx.assetAccount.create({ data: account });
	// Inserting a leg moves the account's balance and counted units (a trigger);
	// the stored figures are written back once everything is in.
	if (legs.length > 0) await tx.accountLeg.createMany({ data: legs });
	const rows = <T>(list: readonly Row[]) =>
		list.map((r) => unpackRow(r) as unknown as T);
	await tx.assetSnapshot.createMany({
		data: rows<Prisma.AssetSnapshotUncheckedCreateInput>(snapshot.snapshots),
	});
	await tx.assetHistory.createMany({
		data: rows<Prisma.AssetHistoryUncheckedCreateInput>(snapshot.history),
	});
	await tx.assetRateType.createMany({
		data: rows<Prisma.AssetRateTypeUncheckedCreateInput>(snapshot.rateTypes),
	});
	await tx.assetAccount.update({
		where: { id },
		data: {
			balance: account.balance,
			countedUnits: account.countedUnits,
			updatedAt: account.updatedAt,
		},
	});

	// What pointed at it points at it again, unless it was pointed elsewhere since.
	const { links } = snapshot;
	await tx.transfer.updateMany({
		where: { id: { in: [...links.transfersFrom] }, fromAccountId: null },
		data: { fromAccountId: id },
	});
	await tx.transfer.updateMany({
		where: { id: { in: [...links.transfersTo] }, toAccountId: null },
		data: { toAccountId: id },
	});
	for (const packed of links.wealthTransfers) {
		const side = unpackRow(
			packed,
		) as unknown as Prisma.WealthTransferUncheckedCreateInput;
		const removed = await tx.wealthTransfer.deleteMany({
			where: { id: side.id, assetAccountId: null },
		});
		if (removed.count > 0) {
			await tx.wealthTransfer.create({
				data: { ...side, assetAccountId: id },
			});
		}
	}
	await tx.envelope.updateMany({
		where: {
			id: { in: [...links.liabilityEnvelopes] },
			targetLiabilityId: null,
		},
		data: { targetLiabilityId: id },
	});
	await tx.envelope.updateMany({
		where: { id: { in: [...links.wealthEnvelopes] }, wealthAccountId: null },
		data: { wealthAccountId: id },
	});
	return id;
}
