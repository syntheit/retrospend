"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useState } from "react";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { usePreview } from "~/features/corrections/use-preview";
import { ChangesBlock } from "~/features/entry/changes";
import { api, type RouterInputs } from "~/trpc/react";
import { movedMessage } from "./bulk-categorize-message";

type Input = RouterInputs["entry"]["expense"]["categorize"]["save"];

interface Pending {
	name: string;
	count: number;
	input: Input;
}

/**
 * Bulk categorize as a money action (R30, R15): choosing a category opens a
 * sheet with the server's dry run of the same write Save makes (a category
 * held out of analytics moves your spending), Save runs it, and the Undo
 * toast is the same write over the moves the save answered with, which put
 * each row's category and analytics flag back. It carries the stamps the
 * save left, so a row edited since refuses the whole undo.
 */
export function useBulkCategorize({
	onSaved,
	onChanged,
}: {
	onSaved: () => void;
	onChanged: () => Promise<unknown>;
}) {
	const t = useTranslations("activity.bulk");
	const toast = useToast();
	const utils = api.useUtils();
	const save = api.entry.expense.categorize.save.useMutation();
	const [pending, setPending] = useState<Pending | null>(null);
	// The sheet keeps its content while it closes.
	const [shown, setShown] = useState<Pending | null>(null);

	const dry = usePreview(
		(input: Input) =>
			utils.entry.expense.categorize.preview
				.fetch(input, { staleTime: 0 })
				.catch((error: unknown) => {
					// The server asked again later: nothing is wrong with this move.
					const busy =
						(error as { data?: { problem?: string } } | null)?.data?.problem ===
						"preview_busy";
					throw new Error(t(busy ? "moveBusy" : "moveFailed"));
				}),
		pending?.input ?? null,
	);

	/** `entityIds` are the rows' own ids; `count` is how many the person picked. */
	const choose = useCallback(
		(entityIds: string[], categoryId: string, name: string) => {
			const next = {
				name,
				count: entityIds.length,
				input: { moves: [{ categoryId, ids: entityIds }] },
			};
			setPending(next);
			setShown(next);
		},
		[],
	);

	// Every picked row is already in that category (or none can be moved): saving changes nothing.
	const target = pending?.input.moves[0]?.categoryId;
	const nothingMoves =
		dry.fresh &&
		dry.data !== null &&
		(dry.data.value.updated === 0 ||
			dry.data.value.previous.every((m) => m.categoryId === target));

	/** A failed save throws, so the sheet stays open with its inline error and the person can retry. */
	const send = async () => {
		if (!pending) return;
		let done: Awaited<ReturnType<typeof save.mutateAsync>>;
		try {
			done = await save.mutateAsync(pending.input);
		} catch {
			throw new Error(t("failed"));
		}
		const { previous, stamps } = done.value;
		onSaved();
		toast.saved(movedMessage(t, done.value, pending.name), {
			undo: async () => {
				await save.mutateAsync({
					moves: previous.map((m) => ({ ...m, ids: [...m.ids] })),
					lenient: true,
					expected: stamps,
				});
				await onChanged();
			},
		});
		await onChanged();
	};

	const sheet: ReactNode = (
		<Sheet
			detent="medium"
			onOpenChange={(o) => {
				if (!o) setPending(null);
			}}
			onSubmit={send}
			open={pending !== null}
			submitDisabled={!dry.fresh || nothingMoves}
			submitLabel={t("move")}
			title={
				shown
					? t("categorizeTitle", { count: shown.count, name: shown.name })
					: ""
			}
		>
			<ChangesBlock cannot={dry.error} diff={dry.data} loading={dry.loading} />
		</Sheet>
	);

	return { choose, sheet };
}
