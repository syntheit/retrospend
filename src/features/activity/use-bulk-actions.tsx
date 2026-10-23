"use client";

import { Download, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import type { TransactionVM } from "~/components/rows/types";
import { BulkAction } from "~/components/table/bulk-bar";
import type { TableSelection } from "~/components/table/transaction-table";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useToast } from "~/components/ui/toast";
import { formatDateOnly } from "~/lib/date";
import { categoryTone } from "~/server/services/expense-list/category-tone";
import type { RestoreToken } from "~/server/services/entry/restore-token";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import { api } from "~/trpc/react";

function save(text: string, filename: string) {
	const url = URL.createObjectURL(
		new Blob([text], { type: "text/csv;charset=utf-8;" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Activity's bulk list (activity.html): Categorize, Export CSV and Delete
 * over one selection of your own expenses. Categorize ends with Undo (each
 * row goes back to its category); Delete asks first with a named button,
 * like the row's Delete. Move to project and Mark reviewed have no server
 * write yet (GAPS).
 */
export function useBulkActions(rows: ActivityRowDTO[]) {
	const t = useTranslations("activity.bulk");
	const toast = useToast();
	const utils = api.useUtils();
	const [selected, setSelected] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [deleting, setDeleting] = useState<string[] | null>(null);
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const categories = api.categories.getAll.useQuery(undefined, {
		staleTime: 60_000,
	});
	const recategorize = api.expense.bulkUpdateCategory.useMutation();
	const exportCsv = api.expense.exportCsv.useMutation();
	const remove = api.entry.expense.delete.save.useMutation();
	const restore = api.entry.expense.restore.save.useMutation();
	const refresh = useCallback(() => utils.expense.listV2.invalidate(), [utils]);

	const canSelect = useCallback(
		(tx: TransactionVM) => {
			const r = byId.get(tx.id);
			return (
				!!r &&
				r.source === "personal" &&
				r.kind === "expense" &&
				r.mine &&
				r.canEdit
			);
		},
		[byId],
	);
	const entityIds = (ids: string[]) =>
		ids.flatMap((id) => {
			const r = byId.get(id);
			return r ? [r.entityId] : [];
		});

	const categorize = async (
		ids: string[],
		categoryId: string,
		name: string,
	) => {
		const before = new Map<string, string[]>();
		for (const id of ids) {
			const r = byId.get(id);
			const was = r?.category?.id;
			if (!r || !was) continue;
			before.set(was, [...(before.get(was) ?? []), r.entityId]);
		}
		const undoable = [...before.values()].flat().length === ids.length;
		try {
			await recategorize.mutateAsync({
				expenseIds: entityIds(ids),
				categoryId,
			});
			setSelected(new Set());
			toast.saved(
				t("moved", { count: ids.length, name }),
				undoable
					? {
							undo: async () => {
								for (const [was, expenseIds] of before)
									await recategorize.mutateAsync({
										expenseIds,
										categoryId: was,
									});
								await refresh();
							},
						}
					: undefined,
			);
		} catch {
			toast.failed(t("failed"));
		}
		await refresh();
	};

	const download = async (ids: string[]) => {
		try {
			const { csv } = await exportCsv.mutateAsync({
				expenseIds: entityIds(ids),
			});
			save(csv, `expenses-selected-${formatDateOnly(new Date())}.csv`);
			toast.saved(t("exported", { count: ids.length }));
		} catch {
			toast.failed(t("failed"));
		}
	};

	/**
	 * One delete per row, each with its own restore token. A row that cannot
	 * go (a transfer's fee) does not stop the others; the toast says how many
	 * went, and Undo brings back every one that did.
	 */
	const confirmDelete = async (ids: string[]) => {
		setDeleting(null);
		const tokens: RestoreToken[] = [];
		for (const id of entityIds(ids)) {
			try {
				const out = await remove.mutateAsync({ id });
				tokens.push(out.value.restore);
			} catch {
				// Counted below: the toast names how many could not be deleted.
			}
		}
		setSelected(new Set());
		await refresh();
		if (!tokens.length) {
			toast.failed(t("failed"));
			return;
		}
		const undo = async () => {
			for (const token of tokens) await restore.mutateAsync({ token });
			await refresh();
		};
		const left = ids.length - tokens.length;
		toast.saved(
			left
				? t("deletedSome", { count: tokens.length, left })
				: t("deleted", { count: tokens.length }),
			{ undo },
		);
	};

	const bulk = (ids: string[]): ReactNode => (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<BulkAction icon={Tag} label={t("categorize")} />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{(categories.data ?? []).map((c) => (
						<DropdownMenuItem
							key={c.id}
							onSelect={() => void categorize(ids, c.id, c.name)}
						>
							<CategoryGlyph
								category={{
									id: c.id,
									name: c.name,
									icon: c.icon,
									tone: categoryTone(c.color),
								}}
							/>
							{c.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<BulkAction
				icon={Download}
				label={t("export")}
				onClick={() => void download(ids)}
			/>
			<BulkAction
				icon={Trash2}
				label={t("delete")}
				onClick={() => setDeleting(ids)}
			/>
		</>
	);

	const confirm = deleting ? (
		<ConfirmationDialog
			confirmLabel={t("confirmButton")}
			description={t("confirmBody")}
			onConfirm={() => void confirmDelete(deleting)}
			onOpenChange={(open) => {
				if (!open) setDeleting(null);
			}}
			open
			title={t("confirmTitle", { count: deleting.length })}
			variant="destructive"
		/>
	) : null;

	const selection: TableSelection = { selected, onChange: setSelected };
	return { canSelect, selection, bulk, confirm };
}
