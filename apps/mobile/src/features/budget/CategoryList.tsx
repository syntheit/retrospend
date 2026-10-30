import type { RetrospendClient } from "@retrospend/api-client";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickField } from "@/ui/PickField";
import { PickLabeled, PickMany } from "./pickers";

/** The part of a category an envelope picker needs. */
export interface BudgetCategory {
	id: string;
	name: string;
	icon: string | null;
	tone: number;
}

const PAGE = 200;

/** The person's categories, by name. */
export async function loadCategories(
	api: RetrospendClient,
): Promise<BudgetCategory[]> {
	const out = await api.categories.list({ limit: PAGE });
	return out.items
		.map((c) => ({ id: c.id, name: c.name, icon: c.icon, tone: c.tone }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** A category as a picker row: its bare glyph in its own color (a picker carries identity). */
function useCategoryRows(categories: readonly BudgetCategory[]) {
	const { color, size } = useTheme();
	return categories.map((c) => ({
		id: c.id,
		label: c.name,
		lead: (
			<CategoryGlyph
				category={c}
				color={categoryColor(color, c.tone)}
				size={size.icon.phone}
			/>
		),
	}));
}

/**
 * Several categories: a trigger that says how many, and the picker sheet
 * (search, bare glyphs, a check per row, Done). The caller gets the id that
 * was pressed.
 */
export function CategoryList({
	categories,
	selected,
	onPress,
	label,
}: {
	categories: readonly BudgetCategory[];
	selected: ReadonlySet<string>;
	onPress: (id: string) => void;
	label: string;
}) {
	const t = useTranslations("mobile.budget.categories");
	const tp = useTranslations("mobile.pickers");
	const rows = useCategoryRows(categories);
	return (
		<PickMany
			empty={tp("category.empty")}
			find={t("find")}
			label={label}
			onToggle={onPress}
			rows={rows}
			selected={selected}
			summary={
				selected.size > 0 ? t("count", { count: selected.size }) : t("pick")
			}
		/>
	);
}

/** One category: the picker trigger with the category's glyph and name. */
export function CategoryPick({
	categories,
	value,
	onChange,
	label,
}: {
	categories: readonly BudgetCategory[];
	value: string | null;
	onChange: (id: string | null) => void;
	label: string;
}) {
	const t = useTranslations("mobile.budget.categories");
	const tp = useTranslations("mobile.pickers");
	const rows = useCategoryRows(categories);
	return (
		<PickLabeled label={label}>
			<PickField
				empty={tp("category.empty")}
				find={t("find")}
				label={label}
				onChange={onChange}
				placeholder={t("pickOne")}
				rows={rows}
				title={label}
				value={value}
				variant="pill"
			/>
		</PickLabeled>
	);
}
