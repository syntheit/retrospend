import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { CategoryTile, ListRow, StaleNote } from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { CategorySheet } from "./CategorySheet";
import { CATEGORIES_CACHE, type Category, fetchCategories } from "./source";

/**
 * The categories list: each with its tile, tap to rename, recolor or change
 * its icon, and Add category at the top. Deleting and merging are on the web.
 */
export function CategoriesScreen() {
	const t = useTranslations("mobile.settings.categories");
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const { color, space, type } = useTheme();
	const fetch = useMemo(() => (api ? fetchCategories(api) : null), [api]);
	const { state, reload } = useCachedRead(CATEGORIES_CACHE, fetch);
	const [editing, setEditing] = useState<Category | null>(null);
	const [open, setOpen] = useState(false);

	if (state.status !== "ready") {
		return (
			<Screen>
				<EmptyState
					detail={state.status === "error" ? t("errorDetail") : undefined}
					title={state.status === "error" ? t("error") : loading}
				/>
			</Screen>
		);
	}
	const all = state.data;
	const show = (category: Category | null) => {
		setEditing(category);
		setOpen(true);
	};
	return (
		<>
			<Screen flush>
				<StaleNote since={state.staleSince} />
				<View style={{ alignItems: "flex-start", padding: space[4] }}>
					<Button label={t("addTitle")} onPress={() => show(null)} />
				</View>
				{all.map((category) => (
					<ListRow
						accessibilityLabel={`${category.name}, ${t("count", { count: category.expenseCount })}`}
						key={category.id}
						onPress={() => show(category)}
					>
						<CategoryTile category={category} />
						<Text
							numberOfLines={1}
							style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
						>
							{category.name}
						</Text>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{t("count", { count: category.expenseCount })}
						</Text>
					</ListRow>
				))}
			</Screen>
			<CategorySheet
				all={all}
				category={editing}
				onClose={() => setOpen(false)}
				onDone={() => void reload()}
				visible={open}
			/>
		</>
	);
}
