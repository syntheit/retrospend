import type { RetrospendClient } from "@retrospend/api-client";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { ChoiceList, TextField } from "./fields";

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

/** Names that contain the text, ignoring case and accents. */
export function matchCategories(
	categories: readonly BudgetCategory[],
	query: string,
): BudgetCategory[] {
	const fold = (s: string) =>
		s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	const q = fold(query.trim());
	return q === ""
		? [...categories]
		: categories.filter((c) => fold(c.name).includes(q));
}

/**
 * Categories as a checked list with a find field, each with its bare glyph in
 * its own color (a picker carries identity). One choice or several is the
 * caller's: it gets the id that was pressed.
 */
export function CategoryList({
	categories,
	selected,
	onPress,
	label,
	extra,
}: {
	categories: readonly BudgetCategory[];
	selected: ReadonlySet<string>;
	onPress: (id: string) => void;
	label?: string;
	/** A choice ahead of the categories (Everything else). */
	extra?: { id: string; label: string };
}) {
	const t = useTranslations("mobile.budget.categories");
	const { color, size, space } = useTheme();
	const [query, setQuery] = useState("");
	const shown = useMemo(
		() => matchCategories(categories, query),
		[categories, query],
	);
	return (
		<View style={{ gap: space[2] }}>
			<TextField label={t("find")} onChangeText={setQuery} value={query} />
			<ChoiceList
				choices={[
					...(extra ? [extra] : []),
					...shown.map((c) => ({
						id: c.id,
						label: c.name,
						lead: (
							<CategoryGlyph
								category={c}
								color={categoryColor(color, c.tone)}
								size={size.icon.phone}
							/>
						),
					})),
				]}
				label={label}
				onPress={onPress}
				selected={selected}
			/>
		</View>
	);
}
