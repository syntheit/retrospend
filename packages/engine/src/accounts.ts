/** Accounts with their legs and snapshots, as one aggregate. */
import { tableReads, tableWrites } from "./crud";
import { NotFoundError } from "./errors";
import {
	InvalidInputError,
	type Reader,
	type TableRows,
	type Writer,
} from "./port";

export type AccountRow = TableRows["accounts"];
export type LegRow = TableRows["legs"];
export type SnapshotRow = TableRows["snapshots"];

export interface AccountAggregate {
	readonly account: AccountRow;
	readonly legs: readonly LegRow[];
	readonly snapshots: readonly SnapshotRow[];
}

export function accountReads(r: Reader) {
	const accounts = tableReads(r, "accounts");
	const assemble = (account: AccountRow): AccountAggregate => ({
		account,
		legs: r.list("legs").filter((l) => l.accountId === account.id),
		snapshots: r.list("snapshots").filter((s) => s.accountId === account.id),
	});
	return {
		get(id: string): AccountAggregate | undefined {
			const account = accounts.get(id);
			return account && assemble(account);
		},
		list: (): AccountAggregate[] => accounts.list().map(assemble),
	};
}

export function accountRepo(w: Writer) {
	const reads = accountReads(w);
	const accounts = tableWrites(w, "accounts");
	const legs = tableWrites(w, "legs");
	const snapshots = tableWrites(w, "snapshots");

	const needAccount = (id: string | null) => {
		if (id === null || !accounts.get(id))
			throw new NotFoundError(`accounts ${id} does not exist`);
	};
	const belongs = (kind: string, rowAccountId: string | null, id: string) => {
		if (rowAccountId !== id)
			throw new InvalidInputError(
				`A ${kind} of ${rowAccountId} is not ${id}'s`,
			);
	};

	return {
		...reads,
		/** Adds the account with its legs and snapshots; an existing id throws InvalidInputError. */
		create({ account, legs: ls, snapshots: ss }: AccountAggregate) {
			for (const l of ls) belongs("leg", l.accountId, account.id);
			for (const s of ss) belongs("snapshot", s.accountId, account.id);
			accounts.insert(account);
			for (const l of ls) legs.insert(l);
			for (const s of ss) snapshots.insert(s);
		},
		/** Changes the account row only; its legs and snapshots stay. */
		updateAccount: (account: AccountRow) => accounts.replace(account),
		addLeg(leg: LegRow) {
			needAccount(leg.accountId);
			legs.insert(leg);
		},
		addSnapshot(snapshot: SnapshotRow) {
			needAccount(snapshot.accountId);
			snapshots.insert(snapshot);
		},
		/** Removes the account and everything that hangs off it: legs, snapshots, rate switches. */
		remove(id: string): boolean {
			if (!accounts.get(id)) return false;
			for (const l of w.list("legs")) if (l.accountId === id) legs.remove(l.id);
			for (const s of w.list("snapshots"))
				if (s.accountId === id) snapshots.remove(s.id);
			for (const s of w.list("rateSwitches"))
				if (s.accountId === id) w.delete("rateSwitches", s.id);
			return accounts.remove(id);
		},
	};
}
