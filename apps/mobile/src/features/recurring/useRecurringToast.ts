import { useCallback } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";

/**
 * A confirm ends in a toast that undoes it (R15), and a pause or resume ends
 * in one that puts it back. A confirm's token is the server's (POST
 * /recurring/undo, single use); a pause is undone by writing the old value.
 * `onChanged` runs after the write and after an undo.
 */
export function useRecurringToast() {
	const { api } = useSession();
	const toast = useToast();
	const tc = useTranslations("mobile.common");
	const tw = useTranslations("mobile.budget.write");

	return useCallback(
		(done: {
			message: string;
			undo: () => Promise<void>;
			onChanged: () => void;
		}) => {
			done.onChanged();
			toast.show({
				message: done.message,
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						try {
							await done.undo();
							toast.show({ message: tw("undone") });
							done.onChanged();
						} catch {
							toast.show({ message: tw("undoError") });
						}
					},
				},
			});
		},
		[toast, tc, tw],
	);
}

/** Undoes a confirm from its token. */
export function useConfirmUndo() {
	const { api } = useSession();
	return useCallback(
		(token: string) => async () => {
			if (!api) throw new Error("Signed out");
			await api.recurring.undo(
				{ token },
				{ context: { idempotencyKey: newClientId() } },
			);
		},
		[api],
	);
}
