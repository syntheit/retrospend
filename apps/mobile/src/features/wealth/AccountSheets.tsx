import { useRef } from "react";
import { AccountSheet } from "./AccountSheet";
import type { AccountAction } from "./actions";
import { CloseAccountSheet } from "./CloseAccountSheet";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import type { Account, CurrencyInfo } from "./source";
import { UpdateBalanceSheet } from "./UpdateBalanceSheet";
import { useCurrencyInfo } from "./useCurrencyInfo";

/** Which sheet is open and for which account; "add" has no account. */
export type SheetTarget =
	| { kind: "add"; account: null }
	| { kind: AccountAction; account: Account };

/**
 * The sheets an account can open, one host for the list and the account page.
 * The target says which is open; the others stay mounted and closed, so a
 * sheet slides away instead of vanishing when it closes. Delete leads to
 * Close instead, and a deleted account tells the screen so it can leave.
 */
export function AccountSheets({
	target,
	onTarget,
	home,
	onDone,
	onDeleted,
}: {
	target: SheetTarget | null;
	onTarget: (next: SheetTarget | null) => void;
	home: string;
	/** A write went through (or was undone): the screen behind refreshes. */
	onDone: () => void;
	/** The account is gone; defaults to `onDone`. */
	onDeleted?: () => void;
}) {
	const catalog: CurrencyInfo[] = useCurrencyInfo();
	// The sheets keep the last account while they slide away.
	const last = useRef<Account | null>(null);
	if (target?.account) last.current = target.account;
	const account = target?.account ?? last.current;
	const kind = target?.kind ?? null;
	const close = () => onTarget(null);
	return (
		<>
			<AccountSheet
				account={null}
				catalog={catalog}
				home={home}
				onClose={close}
				onDone={onDone}
				visible={kind === "add"}
			/>
			{account ? (
				<>
					<AccountSheet
						account={account}
						catalog={catalog}
						home={home}
						onClose={close}
						onDone={onDone}
						visible={kind === "edit"}
					/>
					<UpdateBalanceSheet
						account={account}
						catalog={catalog}
						home={home}
						onClose={close}
						onDone={onDone}
						visible={kind === "update"}
					/>
					<CloseAccountSheet
						account={account}
						onClose={close}
						onDone={onDone}
						reopen={false}
						visible={kind === "close"}
					/>
					<CloseAccountSheet
						account={account}
						onClose={close}
						onDone={onDone}
						reopen
						visible={kind === "reopen"}
					/>
					<DeleteAccountSheet
						account={account}
						onClose={close}
						onCloseInstead={() => onTarget({ kind: "close", account })}
						onDone={onDeleted ?? onDone}
						visible={kind === "delete"}
					/>
				</>
			) : null}
		</>
	);
}
