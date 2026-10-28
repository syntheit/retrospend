import { useCallback } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";

/** Which family of v1 writes an undo token belongs to. */
export type UndoFamily = "budget" | "accounts" | "transfers" | "income";

/**
 * A money write ends in a toast that undoes it (R15). The token is the
 * server's: single use, 24 hours, and it answers 409 when the rows it guards
 * changed since. `onChanged` runs after the write and after an undo, so the
 * screen behind refreshes either way.
 */
export function useUndoToast(family: UndoFamily) {
	const { api } = useSession();
	const toast = useToast();
	const tc = useTranslations("mobile.common");
	const tw = useTranslations("mobile.budget.write");

	const undo = useCallback(
		async (token: string): Promise<boolean> => {
			if (!api) return false;
			try {
				// A fresh key: undoing is its own write, not a replay of the first.
				const options = { context: { idempotencyKey: newClientId() } };
				if (family === "budget") await api.budget.undo({ token }, options);
				else if (family === "transfers") {
					await api.transfers.undo({ token }, options);
				} else if (family === "income") {
					await api.income.undo({ token }, options);
				} else await api.accounts.undo({ token }, options);
				return true;
			} catch {
				return false;
			}
		},
		[api, family],
	);

	return useCallback(
		(done: {
			message: string;
			/** Null when the server could not make one (the write cannot be taken back). */
			token: string | null;
			onChanged: () => void;
		}) => {
			done.onChanged();
			toast.show({
				message: done.message,
				undo: done.token
					? {
							label: tc("undo"),
							onUndo: async () => {
								const ok = await undo(done.token as string);
								toast.show({ message: ok ? tw("undone") : tw("undoError") });
								if (ok) done.onChanged();
							},
						}
					: undefined,
			});
		},
		[toast, tc, tw, undo],
	);
}
