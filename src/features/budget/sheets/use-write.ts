"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useCallback } from "react";
import { formatMoney, type MoneyValue } from "~/components/money/format";
import { useToast } from "~/components/ui/toast";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";

/** A fresh client id: writes carry one so a retry is a no-op (idempotent). */
export const newId: () => string = generateId;

/**
 * What every Budget sheet needs after a money write: refresh what shows the
 * budget (the page, Home and the server-rendered parts), the one toast with
 * Undo (R15), and the undo of the movement kinds (assign, move, cover, take
 * back, plan) which all mirror through `envelope.undo`.
 */
export function useBudgetWrite() {
	const utils = api.useUtils();
	const router = useRouter();
	const locale = useLocale();
	const toast = useToast();
	const undoMovement = api.envelope.undo.useMutation();

	const refresh = useCallback(async () => {
		await Promise.all([utils.envelope.invalidate(), utils.home.invalidate()]);
		router.refresh();
	}, [utils, router]);

	/** The toast after a write; `undo` runs the inverse write, then refreshes. */
	const saved = useCallback(
		(text: string, undo?: () => Promise<unknown>) => {
			toast.saved(text, {
				undo: undo
					? async () => {
							await undo();
							await refresh();
						}
					: undefined,
			});
		},
		[toast, refresh],
	);

	/** Undo for rows written by the movement kinds: a batch or one movement. */
	const undoOf = useCallback(
		(target: { batchId: string } | { movementId: string }) => () =>
			undoMovement.mutateAsync({ id: newId(), target }),
		[undoMovement],
	);

	const money = useCallback(
		(value: MoneyValue | null) => formatMoney(value, { locale }) ?? "",
		[locale],
	);

	return { refresh, saved, undoOf, money };
}
