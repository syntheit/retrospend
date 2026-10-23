"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { SplitRef } from "~/lib/shared-split-input";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { useSettled } from "../shared-ui";
import {
	type ExpenseDraft,
	isShared,
	personalInput,
	sharedInput,
} from "./draft";

type Opts = {
	home: string;
	you: SplitRef;
	categoryName: string;
	/** No errors: the preview may run. */
	valid: boolean;
};

/**
 * Preview, save, delete and undo for the Add expense sheet (R30, R15). The
 * preview is the server's dry run of the very input Save sends, debounced;
 * every save ends with a toast whose Undo is the write's own inverse.
 */
export function useExpenseSave(d: ExpenseDraft, o: Opts) {
	const t = useTranslations("entry.expense.toast");
	const toast = useToast();
	const shared = isShared(d);
	const editing = d.editing;
	const personal = personalInput(d, o);
	const split = sharedInput(d, o);
	const sharedFull = split
		? {
				...split,
				projectId: d.projectId,
				// An edit always sends the note, so emptying it clears it.
				notes: split.notes ?? null,
			}
		: null;

	// Once a save starts the previews stop: the write's own invalidation
	// would otherwise rerun a create preview against the row it just made.
	const [saving, setSaving] = useState(false);
	const settled = useSettled(
		o.valid ? { shared, editing, personal, sharedFull } : null,
		350,
	);
	const key = saving ? null : settled;
	const live = {
		placeholderData: keepPreviousData,
		staleTime: 5_000,
		retry: false,
	};
	const pc = api.entry.expense.create.preview.useQuery(
		key?.personal ?? EMPTY_P,
		{
			...live,
			enabled: !!key?.personal && !key.shared && !key.editing,
		},
	);
	const pu = api.entry.expense.update.preview.useQuery(
		key?.personal ?? EMPTY_P,
		{
			...live,
			enabled:
				!!key?.personal && !key.shared && key.editing?.source === "personal",
		},
	);
	const sc = api.entry.shared.create.preview.useQuery(
		{
			...(key?.sharedFull ?? EMPTY_S),
			notes: key?.sharedFull?.notes ?? undefined,
			projectId: key?.sharedFull?.projectId ?? undefined,
		},
		{ ...live, enabled: !!key?.sharedFull && key.shared && !key.editing },
	);
	const su = api.entry.shared.update.preview.useQuery(
		{
			...(key?.sharedFull ?? EMPTY_S),
			id: editing?.id ?? "",
			notes: key?.sharedFull?.notes ?? null,
			projectId: key?.sharedFull?.projectId ?? null,
		},
		{
			...live,
			enabled:
				!!key?.sharedFull && key.shared && key.editing?.source === "shared",
		},
	);
	const active = !o.valid
		? null
		: shared
			? editing
				? su
				: sc
			: editing
				? pu
				: pc;

	const m = {
		create: api.entry.expense.create.save.useMutation(),
		update: api.entry.expense.update.save.useMutation(),
		remove: api.entry.expense.delete.save.useMutation(),
		restore: api.entry.expense.restore.save.useMutation(),
		revert: api.entry.expense.revert.save.useMutation(),
		sCreate: api.entry.shared.create.save.useMutation(),
		sUpdate: api.entry.shared.update.save.useMutation(),
		sRevert: api.entry.shared.revert.save.useMutation(),
		sDelete: api.entry.shared.delete.save.useMutation(),
	};
	const title = personal?.title ?? split?.description ?? "";

	/** Saves and shows the Undo toast; `quiet` when Add and new says it instead. */
	async function save(quiet?: boolean) {
		setSaving(true);
		try {
			await write(quiet);
		} catch (error) {
			setSaving(false);
			throw error;
		}
	}

	async function write(quiet?: boolean) {
		if (shared && sharedFull) {
			if (editing) {
				const r = await m.sUpdate.mutateAsync({
					...sharedFull,
					id: editing.id,
				});
				toast.saved(t("saved", { title }), {
					undo: () => m.sRevert.mutateAsync(r.value.restore),
				});
				return;
			}
			const r = await m.sCreate.mutateAsync({
				...sharedFull,
				// The sheet's own id: a second click cannot write a second row.
				id: d.newId,
				notes: sharedFull.notes ?? undefined,
				projectId: sharedFull.projectId ?? undefined,
			});
			toast.saved(t(quiet ? "ready" : "added", { title }), {
				// Undo right away takes back the "split with you" notices too.
				undo: () =>
					m.sDelete.mutateAsync({
						id: r.value.id,
						confirmUnsettled: true,
						retract: true,
					}),
			});
			return;
		}
		if (!personal) throw new Error("Nothing to save");
		if (editing) {
			const r = await m.update.mutateAsync(personal);
			toast.saved(t("saved", { title }), {
				undo: () => m.revert.mutateAsync(r.value.restore),
			});
			return;
		}
		const r = await m.create.mutateAsync(personal);
		toast.saved(t(quiet ? "ready" : "added", { title }), {
			undo: () => m.remove.mutateAsync({ id: r.value.id }),
		});
	}

	/** Personal: deleted with an Undo. Shared: the caller confirms first; no undo. */
	async function remove() {
		if (!editing) return;
		if (editing.source === "shared") {
			await m.sDelete.mutateAsync({ id: editing.id, confirmUnsettled: true });
			toast.saved(t("deleted", { title }));
			return;
		}
		const r = await m.remove.mutateAsync({ id: editing.id });
		toast.saved(t("deleted", { title }), {
			undo: () => m.restore.mutateAsync({ token: r.value.restore }),
		});
	}

	return {
		preview: active?.data ?? null,
		previewLoading: !!active?.isFetching,
		previewError: active?.error?.message ?? null,
		save,
		remove,
		busy: Object.values(m).some((x) => x.isPending),
	};
}

const EMPTY_P = {
	id: "",
	title: "",
	amount: "0",
	currency: "USD",
	date: "1970-01-01",
	categoryId: "",
};
const EMPTY_S = {
	amount: "0",
	currency: "USD",
	description: "",
	date: "1970-01-01",
	paidBy: { participantType: "user" as const, participantId: "" },
	splitWith: [{ participantType: "user" as const, participantId: "" }],
	splitMode: "EQUAL" as const,
};
