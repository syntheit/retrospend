import { useMemo, useRef } from "react";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useDeleteEntry } from "@/features/entry/useDeleteEntry";
import { useDeletePending } from "@/features/entry/useDeletePending";
import type { RowOps } from "./ActivityRow";

/**
 * The long-press actions of a row outside Activity (Home's Recent): Edit and
 * Delete, from the same registry as the Activity row (rowActions), without
 * the bulk ones (Select, Categorize). Delete is one entry, so the system alert
 * after the server's dry run and an Undo toast; an entry only this phone has
 * edits and deletes where it waits. The object is stable, so memoized rows
 * keep it.
 */
export function useHomeRowOps(): RowOps {
	const te = useTranslations("mobile.entry");
	const ta = useTranslations("mobile.activity");
	const add = useOptionalAddEntry();
	const deletePending = useDeletePending();
	const deleteOne = useDeleteEntry();
	const latest = useRef({ add, deletePending, deleteOne });
	latest.current = { add, deletePending, deleteOne };
	const canEdit = add !== null;
	return useMemo<RowOps>(
		() => ({
			words: {
				select: "",
				edit: te("edit"),
				categorize: "",
				delete: ta("bulk.delete"),
			},
			canEdit,
			edit: (item) =>
				item.unsynced
					? latest.current.add?.editPending(item.entityId)
					: latest.current.add?.edit(
							item.entityId,
							item.source === "shared" ? "shared" : undefined,
						),
			remove: (item) =>
				item.unsynced
					? latest.current.deletePending({
							clientId: item.entityId,
							kind: item.kind,
							title: item.title,
						})
					: latest.current.deleteOne({
							id: item.entityId,
							shared: false,
							title: item.title,
						}),
		}),
		[te, ta, canEdit],
	);
}
