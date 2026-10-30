import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { FieldError, FieldLabel } from "@/ui/TextField";
import { CategoryPicker } from "./CategoryPicker";
import { recentCategories } from "./catalog";
import { type ExpenseDraft, pickCategory } from "./draft";
import type { EntryCatalog } from "./types";

/** Two recents fit one line next to the More chip on the narrowest phone. */
const RECENTS = 2;

/**
 * The category: your three most used as chips with their bare glyph, and a
 * More chip that opens every category in a sheet. A pick outside the recents
 * takes the first slot, so the one chosen is always on screen; a saved
 * category that is not in your catalog (someone else's on their split) stays.
 */
export function CategoryRow({
	catalog,
	draft,
	error,
	onChange,
}: {
	catalog: EntryCatalog;
	draft: ExpenseDraft;
	/** Shown once Add was pressed. */
	error: boolean;
	onChange: (patch: Partial<ExpenseDraft>) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { color, size, space } = useTheme();
	const recents = recentCategories(catalog, RECENTS, draft.categoryId);
	// Someone else's category on their split: not in your catalog, but kept.
	const saved =
		draft.editing?.category &&
		!catalog.categories.some((c) => c.id === draft.editing?.category?.id)
			? draft.editing.category
			: null;
	return (
		<View style={{ gap: space[2] }}>
			<FieldLabel>{t("category")}</FieldLabel>
			<View
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: space[2],
				}}
			>
				{saved ? (
					<Chip
						label={saved.name}
						onPress={() => onChange(pickCategory(draft, undefined, saved.id))}
						selected={draft.categoryId === saved.id}
					/>
				) : null}
				{recents.map((category) => (
					<Chip
						key={category.id}
						label={category.name}
						leading={
							<CategoryGlyph
								category={category}
								color={categoryColor(color, category.tone)}
								size={size.icon.phone}
							/>
						}
						onPress={() => onChange(pickCategory(draft, category, category.id))}
						selected={draft.categoryId === category.id}
					/>
				))}
				{catalog.categories.length > recents.length ? (
					<CategoryPicker
						categories={catalog.categories}
						onChange={(categoryId) =>
							onChange(
								pickCategory(
									draft,
									catalog.categories.find((c) => c.id === categoryId),
									categoryId,
								),
							)
						}
						recent={recents}
						value={draft.categoryId}
					/>
				) : null}
			</View>
			{error ? <FieldError>{t("errors.category")}</FieldError> : null}
		</View>
	);
}
