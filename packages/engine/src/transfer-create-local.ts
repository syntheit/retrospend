/**
 * transfer.create on the device: createTransferIn
 * (src/server/services/transfers/create.mutation.ts) over the store. Every
 * rule and every row is the domain's (transfers/rows: the Transfer, one leg
 * per place, the counted units that follow the money, the fee's expense and
 * FEE leg); this file loads the places and rates from the store, checks the
 * body as the v1 route does, writes the rows in the server's order and says
 * when the move is the server's (transfer-kit.ts).
 *
 * - Every id is the caller's (the transfer, both legs, the fee's expense and
 *   leg), so the device's rows and the server's meet by id. A taken id is
 *   refused and nothing is written.
 * - The fee is an expense written through the one expense create
 *   (expense-create.ts) in the same transaction, with the one fee text
 *   (TRANSFER_FEE_TEXT), and the transfer names it (`feeExpenseId`), which is
 *   what makes the expense edit and delete refuse it (expense-write-local.ts).
 * - The budget: a move the device books touches no envelope. A budget it
 *   cannot read, a rate it lacks for the budget side, or a crossing into the
 *   home currency's book is the server's: TransferOnlineError, nothing
 *   written. A leg or fee no rate values is a MissingRateError (unbooked),
 *   never a booking at 1.
 * - `note` is the person's text: it stays in the store and leaves the engine
 *   only through transferWithoutText (wealth-rows.ts).
 *
 * Run through LocalDb.write or LocalDb.preview.
 */
import { createTransferSchema } from "@retrospend/api-contract/transfers";
import { moveDay } from "@retrospend/domain/accounts/move-day";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import type { TransferKind } from "@retrospend/domain/transfers/plan";
import {
	sideCurrency,
	type TransferLegRow,
	type TransferRows,
	type TransferSide,
	transferRows,
} from "@retrospend/domain/transfers/rows";
import {
	type Moment,
	openAccount,
	pickOf,
	putAccount,
	refuseBadBody,
	zoneOf,
} from "./account-kit";
import { insertLegs } from "./account-legs";
import type { AccountRow, LegRow } from "./accounts";
import { createExpense } from "./expense-create";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import type { TableRows } from "./port";
import type { Repos } from "./repos";
import { refuseOnlineBudget, refusingTransfer } from "./transfer-kit";

export const TRANSFER_CREATE = "transfer.create";

/** The v1 body of a transfer (createTransferSchema), with every client id required: the device makes them all. */
export interface TransferBody {
	readonly id: string;
	readonly fromLegId: string;
	readonly toLegId: string;
	readonly feeExpenseId: string;
	readonly feeLegId: string;
	readonly fromAccountId: string | null;
	readonly toAccountId: string | null;
	readonly fromCurrency?: string | null;
	readonly toCurrency?: string | null;
	readonly fromAmount: string;
	readonly toAmount?: string | null;
	readonly kind?: TransferKind | null;
	/** YYYY-MM-DD; today in the person's zone when omitted. */
	readonly date?: string | null;
	readonly note?: string | null;
	readonly fee?: {
		readonly amount: string;
		readonly accountId?: string | null;
	} | null;
	/** What the server's budget side reads; a move the device books has none. */
	readonly envelopeId?: string | null;
	readonly putIn?: string | null;
}

export type CreateTransferInput = TransferBody & Moment;

export interface TransferCreated {
	readonly transfer: TableRows["transfers"];
	/** The source's leg, the destination's, then the fee's. */
	readonly legs: readonly LegRow[];
	readonly feeExpense: ExpenseRow | null;
	/** What the rules made of the move: kind, rate, reference, net worth effect, the budget's effect. */
	readonly rows: TransferRows;
}

/** An account side, open, or Not tracked in a currency. */
function sideOf(
	r: Repos,
	accountId: string | null,
	currency: string | null | undefined,
): TransferSide & { account: AccountRow | null } {
	const account = accountId ? openAccount(r, accountId) : null;
	const side = { account, currency };
	sideCurrency(side);
	return side;
}

const legRowOf = (leg: TransferLegRow, now: Date): LegRow => ({
	id: leg.id,
	accountId: leg.accountId,
	currency: leg.currency,
	date: new Date(leg.date.getTime()),
	createdAt: new Date(now.getTime()),
	amount: leg.amount.toFixed(),
	source: leg.source,
	homeAmount: leg.home ? leg.home.amount.toFixed() : null,
	homeCurrency: leg.home ? leg.home.currency : null,
	// A transfer's legs carry no counted units: the move's counted units go on the account itself.
	countedUnits: "0",
	transferId: leg.transferId,
	expenseId: leg.expenseId,
});

/** The first leg or fee no rate values: the device cannot book it (the server books it with no home value). */
function refuseUnvalued(rows: TransferRows, home: string): void {
	const legs = [...rows.legs, ...(rows.fee ? [rows.fee.leg] : [])];
	const bare = legs.find((l) => l.home === null);
	if (bare) throw new MissingRateError(bare.currency, [bare.currency, home]);
}

/** D4: counted units leave the source and follow the money; the leg writer then caps them at what each account holds. */
function moveCounted(r: Repos, rows: TransferRows): void {
	for (const { accountId, delta } of rows.countedMoves) {
		const account = r.accounts.get(accountId)?.account;
		if (!account) continue;
		putAccount(r, {
			...account,
			countedUnits: dec(account.countedUnits).add(delta).toFixed(),
		});
	}
}

export function createTransfer(
	input: CreateTransferInput,
): WriteFn<TransferCreated> {
	return (r) =>
		refusingTransfer(async () => {
			refuseBadBody(createTransferSchema, input);
			const zone = zoneOf(r, input);
			const date = moveDay(input.date, input.now, zone);
			const home = r.settings.require().homeCurrency;
			const from = sideOf(r, input.fromAccountId, input.fromCurrency);
			const to = sideOf(r, input.toAccountId, input.toCurrency);
			const feeAccount = input.fee?.accountId
				? openAccount(r, input.fee.accountId)
				: null;
			// The fee account's currency too: a fee in a third currency is valued at the day's rate.
			const pick = pickOf(r, [
				home,
				sideCurrency(from),
				sideCurrency(to),
				...(feeAccount ? [feeAccount.currency] : []),
			]);
			const rows = transferRows({
				from,
				to,
				fromAmount: input.fromAmount,
				toAmount: input.toAmount,
				kind: input.kind,
				pick,
				homeCurrency: home,
				date,
				timeZone: zone,
				note: input.note,
				fee: input.fee && { amount: input.fee.amount, account: feeAccount },
				ids: {
					transfer: input.id,
					fromLeg: input.fromLegId,
					toLeg: input.toLegId,
					feeExpense: input.feeExpenseId,
					feeLeg: input.feeLegId,
				},
			});
			refuseOnlineBudget(r, rows);
			refuseUnvalued(rows, home);

			const { transfer: t } = rows;
			const transfer: TableRows["transfers"] = {
				id: t.id,
				kind: t.kind,
				date: new Date(t.date.getTime()),
				fromAccountId: t.fromAccountId,
				fromAmount: t.fromAmount,
				toAccountId: t.toAccountId,
				toAmount: t.toAmount,
				toCurrency: t.toCurrency,
				feeExpenseId: rows.fee?.expense.id ?? null,
				countedFromUnits: t.countedFromUnits,
				countedToUnits: t.countedToUnits,
				note: t.note,
			};
			r.transfers.insert(transfer);
			// Counted units move first: the legs' writer then caps them at what each account holds once the money moved.
			moveCounted(r, rows);
			const legs = rows.legs.map((l) => legRowOf(l, input.now));
			insertLegs(r.accounts, legs);
			let feeExpense: ExpenseRow | null = null;
			if (rows.fee) {
				feeExpense = await createExpense(rows.fee.expense)(r);
				const fee = legRowOf(rows.fee.leg, input.now);
				insertLegs(r.accounts, [fee]);
				legs.push(fee);
			}
			return { transfer, legs, feeExpense, rows };
		});
}
