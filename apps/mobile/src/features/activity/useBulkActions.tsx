import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickGroup } from "@/ui/pickGroups";
import { BulkSheet } from "./BulkSheet";
import type { BulkAction } from "./bulkWrite";
import { useCategories } from "./useCategories";

export interface BulkActions {
	/** Picks a category, then shows what changes, for these entry ids. */
	categorize: (ids: string[]) => void;
	/** Shows what a delete changes, for these entry ids. */
	remove: (ids: string[]) => void;
	/** The sheets the two open; rendered once, in the screen. */
	sheets: ReactNode;
}

/**
 * Delete and Categorize over a set of expenses, for the selection bar and for
 * one row's swipe and menu: the category picker, then the sheet with the
 * server's dry run before anything is written (R30), then an Undo toast.
 */
export function useBulkActions(onDone: () => void): BulkActions {
	const tp = useTranslations("mobile.pickers");
	const { color, duration, size } = useTheme();
	const categories = useCategories();
	const [choosing, setChoosing] = useState(false);
	const [action, setAction] = useState<BulkAction | null>(null);
	// The ids the open sheet works on stay fixed while it is up.
	const shown = useRef<string[]>([]);

	const groups = useMemo<PickGroup[]>(
		() => [
			{
				key: "all",
				heading: tp("category.all"),
				rows: (categories.state.status === "ready"
					? categories.state.data
					: []
				).map((c) => ({
					id: c.id,
					label: c.name,
					lead: (
						<CategoryGlyph
							category={c}
							color={categoryColor(color, c.tone)}
							size={size.icon.phone}
						/>
					),
					selected: false,
				})),
			},
		],
		[categories.state, color, size.icon.phone, tp],
	);

	const sheets = (
		<>
			<PickerSheet
				clear={tp("clear")}
				empty={tp("category.empty")}
				find={tp("category.find")}
				groups={groups}
				onClose={() => setChoosing(false)}
				onSelect={(id) => {
					const name =
						categories.state.status === "ready"
							? categories.state.data.find((c) => c.id === id)?.name
							: undefined;
					// The picker is still closing: the next sheet waits for it.
					setTimeout(
						() =>
							setAction({
								kind: "category",
								categoryId: id,
								name: name ?? "",
							}),
						duration.sheet,
					);
				}}
				title={tp("category.title")}
				visible={choosing}
			/>
			<BulkSheet
				action={action}
				ids={shown.current}
				onClose={() => setAction(null)}
				onDone={onDone}
			/>
		</>
	);

	return {
		categorize: (ids) => {
			shown.current = ids;
			setChoosing(true);
		},
		remove: (ids) => {
			shown.current = ids;
			setAction({ kind: "delete" });
		},
		sheets,
	};
}
