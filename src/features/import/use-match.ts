"use client";

import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { useToast } from "~/components/ui/toast";
import { categoryNameKey } from "~/lib/category-name-key";
import type { ImportReview } from "~/server/services/import/review";
import { api } from "~/trpc/react";
import { type Choices, withMatched } from "./choices";
import { colorFor, type MatchPick } from "./match-sheet";
import type { CategoryPick } from "./row-controls";
import { undoCreated } from "./undo-created";

/**
 * Match categories' Apply: creates the categories you chose to create (real
 * ones, in every picker and in Settings), sets each name's category on its
 * rows, and offers Undo for both (the rows back, the new categories gone).
 */
export function useMatch({
	data,
	choices,
	setChoices,
	pick,
}: {
	data: ImportReview | undefined;
	choices: Choices;
	setChoices: Dispatch<SetStateAction<Choices>>;
	pick: CategoryPick;
}) {
	const t = useTranslations("importPage.match");
	const toast = useToast();
	const utils = api.useUtils();
	const create = api.categories.create.useMutation();
	const remove = api.categories.remove.useMutation();

	const apply = async (picks: Record<string, MatchPick>) => {
		if (!data) return;
		const byName = new Map(
			pick.categories
				.filter((c) => c.kind === "EXPENSE")
				.map((c) => [categoryNameKey(c.name), c.id]),
		);
		const matches: Record<string, string> = {};
		const created: { id: string; name: string }[] = [];
		for (const [name, p] of Object.entries(picks)) {
			if ("id" in p) {
				matches[name] = p.id;
				continue;
			}
			const existing = byName.get(categoryNameKey(name));
			if (existing) {
				matches[name] = existing;
				continue;
			}
			const category = await create.mutateAsync({
				name,
				color: colorFor(name),
			});
			created.push({ id: category.id, name });
			matches[name] = category.id;
		}
		const before = choices;
		const kinds = new Map(pick.categories.map((c) => [c.id, c.kind]));
		setChoices((c) =>
			withMatched(data.rows, c, matches, (id) => kinds.get(id) !== "INCOME"),
		);
		await utils.entry.catalog.invalidate();
		const count = Object.keys(matches).length;
		toast.saved(
			created.length
				? t("doneCreated", {
						count,
						names: created.map((c) => c.name).join(", "),
					})
				: t("done", { count }),
			{
				undo: async () => {
					await undoCreated(
						created.map((c) => c.id),
						{
							expenseCount: async (id) =>
								(
									await utils.categories.previewRemove.fetch(
										{ id, targetId: null },
										{ staleTime: 0 },
									)
								).value.counts.expense.moved,
							remove: (id) =>
								remove.mutateAsync({ id, targetId: null, refuseIfUsed: true }),
						},
					);
					setChoices(before);
					await utils.entry.catalog.invalidate();
				},
			},
		);
	};
	return { apply };
}
