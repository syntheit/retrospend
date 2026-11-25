"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { usePreview } from "~/features/corrections/use-preview";
import { ChangesBlock } from "~/features/entry/changes";
import { useCategoryName } from "~/hooks/use-category-name";
import { api, type RouterInputs } from "~/trpc/react";
import { SelectField } from "../select-field";
import { RemoveLines } from "./remove-lines";
import { removeRefusalOf } from "./remove-refusal";

type Input = RouterInputs["categories"]["remove"];

/** The select's value for "no category": a delete that leaves the rows uncategorized. */
const NONE = "none";

export interface RemovableCategory {
	id: string;
	/** As people see it (a default category's name is translated). */
	name: string;
}

/**
 * Delete a category, or merge it into another, as a money action (R30, R15):
 * the choice of where its expenses go opens the server's dry run of the same
 * write Save makes (what moves, what is dropped, which envelopes the rows end
 * up in, and that your spending does not change), a refusal is worded by its
 * code, and Save ends with an Undo toast that restores the category and puts
 * every row back (it is refused whole when something changed since).
 */
export function RemoveCategorySheet({
	category,
	categories,
	open,
	onOpenChange,
	onRemoved,
}: {
	category: RemovableCategory | null;
	categories: readonly { id: string; name: string }[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** After the delete committed: the manager moves its selection off it. */
	onRemoved: (id: string) => Promise<unknown> | unknown;
}) {
	const t = useTranslations("settingsV2.categories.remove");
	const sheet = useTranslations("overlays.sheet");
	const toast = useToast();
	const utils = api.useUtils();
	const { displayName } = useCategoryName();
	const remove = api.categories.remove.useMutation();
	const restore = api.categories.restore.useMutation();
	const [target, setTarget] = useState(NONE);
	const [error, setError] = useState<string | null>(null);
	// The sheet keeps its content while it closes.
	const [shown, setShown] = useState<RemovableCategory | null>(null);
	useEffect(() => {
		if (!open || !category) return;
		setShown(category);
		setTarget(NONE);
		setError(null);
	}, [open, category]);

	// Envelope names for the reroute lines: the person's own book, this month.
	const month = api.envelope.getMonth.useQuery(
		{},
		{ enabled: open, retry: false },
	);
	const envelopeName = useCallback(
		(bookId: string, envelopeId: string) => {
			if (month.data?.book.id !== bookId) return null;
			return (
				month.data.groups
					.flatMap((g) => g.envelopes)
					.find((e) => e.id === envelopeId)?.name ?? null
			);
		},
		[month.data],
	);

	const others = categories.filter((c) => c.id !== shown?.id);
	const targetName =
		target === NONE
			? null
			: displayName(others.find((c) => c.id === target)?.name ?? "");
	const input: Input | null =
		open && shown
			? { id: shown.id, targetId: target === NONE ? null : target }
			: null;

	const dry = usePreview(
		(i: Input) =>
			utils.categories.previewRemove
				.fetch(i, { staleTime: 0 })
				.catch((e: unknown) => {
					const refusal = removeRefusalOf(e);
					throw new Error(
						refusal ? t(`refusals.${refusal}`) : t("previewFailed"),
					);
				}),
		input,
	);

	/** A failed save keeps the sheet open with its error, and Delete tries again. */
	const send = async () => {
		if (!input || !shown) return;
		setError(null);
		let done: Awaited<ReturnType<typeof remove.mutateAsync>>;
		try {
			done = await remove.mutateAsync(input);
		} catch (e) {
			const refusal = removeRefusalOf(e);
			setError(refusal ? t(`refusals.${refusal}`) : t("failed"));
			return;
		}
		onOpenChange(false);
		await onRemoved(shown.id);
		const { stash, counts } = done.value;
		const name = shown.name;
		const moved = counts.expense.moved;
		toast.saved(
			targetName && moved > 0
				? t("toastMoved", { count: moved, name, target: targetName })
				: t("toastDeleted", { name }),
			{
				undo: async () => {
					await restore.mutateAsync({ stash });
					await utils.categories.getAll.invalidate();
				},
			},
		);
	};

	return (
		<Sheet
			detent="large"
			footer={
				<>
					<Button kind="secondary" onClick={() => onOpenChange(false)}>
						{sheet("cancel")}
					</Button>
					<Button
						disabled={!dry.fresh}
						kind="danger"
						loading={remove.isPending}
						onClick={() => void send()}
					>
						{target === NONE ? t("delete") : t("moveAndDelete")}
					</Button>
				</>
			}
			onOpenChange={onOpenChange}
			open={open}
			title={shown ? t("title", { name: shown.name }) : ""}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="remove-category-target">{t("moveTo")}</Label>
					<SelectField
						id="remove-category-target"
						onChange={setTarget}
						options={[
							{ value: NONE, label: t("none") },
							...others.map((c) => ({
								value: c.id,
								label: displayName(c.name),
							})),
						]}
						value={target}
					/>
				</div>
				{error ? (
					<p className="text-danger text-small" role="alert">
						{error}
					</p>
				) : null}
				<ChangesBlock
					cannot={dry.error}
					diff={dry.data}
					loading={dry.loading}
					rows={
						dry.data && shown ? (
							<RemoveLines
								envelopeName={envelopeName}
								name={shown.name}
								targetName={targetName}
								value={dry.data.value}
							/>
						) : null
					}
				/>
			</div>
		</Sheet>
	);
}
