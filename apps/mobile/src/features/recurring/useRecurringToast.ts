import { useCallback } from "react";
import { useTranslations } from "use-intl";
import { useToast } from "@/ui/Toast";

/**
 * A pause or resume ends in a toast that puts it back by writing the old
 * value (R15); a confirm, skip or delete uses the write sheet and the
 * server's undo token. `onChanged` runs after the write and after an undo.
 */
export function useRecurringToast() {
	const toast = useToast();
	const tc = useTranslations("mobile.common");
	const tw = useTranslations("mobile.budget.write");

	return useCallback(
		(done: {
			message: string;
			/** Left out, the write cannot be taken back and the toast has no Undo. */
			undo?: () => Promise<void>;
			onChanged: () => void;
		}) => {
			const { undo } = done;
			done.onChanged();
			toast.show({
				message: done.message,
				undo: undo
					? {
							label: tc("undo"),
							onUndo: async () => {
								try {
									await undo();
									toast.show({ message: tw("undone") });
									done.onChanged();
								} catch {
									toast.show({ message: tw("undoError") });
								}
							},
						}
					: undefined,
			});
		},
		[toast, tc, tw],
	);
}
