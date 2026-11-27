import { toMinor } from "@retrospend/domain/money-minor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { deviceWrites } from "@/data/deviceWrites";
import { useSettleToast } from "@/features/recurring/useSettle";
import { wireAmount } from "@/features/write/amount";
import { type UndoFamily, useUndoToast } from "@/features/write/useUndoToast";
import type { SeenAccount, WealthAnswer, WealthDevice } from "./deviceWealth";
import type { Account } from "./source";
import { cachedWealthWrites, wealthWritesOn } from "./wealthFlag";

// What the Wealth sheets need to write through the phone's outbox: the device
// (the dev flag, the engine and the server's word on wealthWrites; any one
// missing and the sheet writes online as it always did), the account as the
// device sees it, and the toast that ends a write.

/**
 * The device's write side for account and transfer writes, or null: the flag
 * is off, no engine runs yet, nothing is signed in, or the server does not say
 * it takes them. While the sheet is open it reads the server's word (the last
 * answer first, so an offline phone decides at once).
 */
export function useWealthDevice(active: boolean): WealthDevice | null {
	const { api, local } = useSession();
	const writes = api ? deviceWrites(api) : null;
	const [on, setOn] = useState(false);
	const engine = writes !== null;
	useEffect(() => {
		// Each opening asks again: what an earlier opening heard is not kept.
		setOn(false);
		if (!active || !api || !local || !engine) return;
		let live = true;
		let answered = false;
		void cachedWealthWrites(local.cache).then((cached) => {
			// The cache is only for before the server answers: never over it.
			if (live && !answered) setOn(cached);
		});
		void wealthWritesOn(api, local.cache).then((now) => {
			answered = true;
			if (live) setOn(now);
		});
		return () => {
			live = false;
		};
	}, [active, api, local, engine]);
	return api && local && writes && on
		? { api, outbox: local.outbox, writes, wealthWrites: true }
		: null;
}

/** An account as the device sees it, and what the write is based on. */
export interface OpenedAccount<A extends Account | null> {
	/** The account with the device's balance (its own unsent writes included) in place of the pulled one. */
	shown: A;
	/** The version and stored balance the sheet showed: what the write names. Null while there is no account. */
	opened: A extends null ? null : SeenAccount;
}

/**
 * The account for a sheet that shows or names its balance. With the device,
 * the balance is the overlay's: the pulled row with this phone's own unsent
 * writes laid over it, so a person's own queued transfer does not make their
 * balance update park for a change they made themselves. Without it, or when
 * the device cannot read the account, it is the screen's own. The version is
 * always the screen's (the server's; the device's own is a placeholder until
 * its write is acked).
 */
export function useOpenedAccount<A extends Account | null>(
	device: WealthDevice | null,
	account: A,
	active: boolean,
): OpenedAccount<A> {
	const [stored, setStored] = useState<{
		id: string;
		/** The pulled row the overlay was laid over. */
		pulled: { version: number; balance: string };
		balance: string;
	} | null>(null);
	// The device is made again on every render: only whether there is one counts.
	const latest = useRef(device);
	latest.current = device;
	const has = device !== null;
	const id = account?.id ?? null;
	// Read again when the screen's own copy moves (a pull, a write, an Undo).
	const seen = account
		? `${account.version}:${account.balance.minor}:${account.updatedAt}`
		: "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: `seen` only says the account moved
	useEffect(() => {
		setStored(null);
		const writes = latest.current?.writes;
		if (!active || !has || !writes || id === null) return;
		let live = true;
		// The overlay's balance goes with the pulled row it was laid over. Only
		// when that row is the screen's own (the same version and the same
		// stored balance) do the two agree. A balance moves without the version
		// (a transfer, an income leg), so both are compared: when the screen is
		// ahead (another device moved the account and the engine has not pulled
		// it yet) the screen's balance and version stand.
		Promise.all([writes.storedAccount(id), writes.overlayAccount(id)])
			.then(([pulled, overlay]) => {
				if (live && pulled && overlay)
					setStored({
						id,
						pulled: { version: pulled.version, balance: pulled.balance },
						balance: overlay.balance,
					});
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [active, has, id, seen]);
	return useMemo(() => {
		if (!account) return { shown: account, opened: null } as OpenedAccount<A>;
		const { currency } = account.balance;
		const own = wireAmount(account.balance.minor, currency);
		const balance =
			stored?.id === account.id && sameRow(stored.pulled, account)
				? stored.balance
				: own;
		const opened = { version: account.version, balance };
		try {
			const minor = toMinor(balance, currency);
			return {
				shown:
					balance === own
						? account
						: { ...account, balance: { minor, currency } },
				opened,
			} as OpenedAccount<A>;
		} catch {
			// A balance that does not read stays the screen's own.
			return {
				shown: account,
				opened: { version: account.version, balance: own },
			} as OpenedAccount<A>;
		}
	}, [account, stored]);
}

/** Whether the pulled row is the one the screen shows: the same version and, numerically, the same stored balance. */
function sameRow(
	pulled: { version: number; balance: string },
	account: Account,
): boolean {
	if (pulled.version !== account.version) return false;
	try {
		return (
			toMinor(pulled.balance, account.balance.currency) ===
			account.balance.minor
		);
	} catch {
		return false;
	}
}

/**
 * Ends a write the sheet may have queued: the toast of the device's answer
 * (Undo takes it out of the outbox, or through the server once sent), or, for
 * a write that went online, the server-token Undo toast of its family.
 */
export function useWealthEnd(family: UndoFamily) {
	const settled = useSettleToast();
	const announce = useUndoToast(family);
	return useCallback(
		(
			out: object,
			done: {
				device: WealthDevice | null;
				title: string;
				/** The sentence for a write the server has. */
				message: string;
				onChanged: () => void;
			},
		) => {
			const { device } = done;
			if (device && isWealthAnswer(out)) {
				settled(out, {
					device,
					title: done.title,
					synced: done.message,
					onChanged: done.onChanged,
				});
				return;
			}
			const token = (out as { undo?: unknown }).undo;
			announce({
				message: done.message,
				token: typeof token === "string" ? token : null,
				onChanged: done.onChanged,
			});
		},
		[settled, announce],
	);
}

/** An answer of the device's queue (the API's own answers have no `settled`). */
export const isWealthAnswer = (
	out: object,
): out is Exclude<WealthAnswer, { settled: "online" }> =>
	"settled" in out && (out as { settled: unknown }).settled !== "online";
