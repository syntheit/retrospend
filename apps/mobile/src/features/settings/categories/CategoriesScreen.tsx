import { Stack } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { AddButton } from "@/ui/AddButton";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { CategoryTile, ListGroup, ListRow, StaleNote } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { StatusText } from "@/ui/StatusText";
import { SettingsPage } from "../parts";
import { useCategories } from "../useSettings";
import { CategorySheet } from "./CategorySheet";
import type { Category } from "./source";

/**
 * The categories list: each with its tile, its name and how many expenses
 * use it, then "Not counted in spending" when it is left out of totals. Tap
 * one to rename, recolor or change its icon; the plus in the bar adds one.
 * Deleting and merging are on the web.
 */
export function CategoriesScreen() {
	const t = useTranslations("mobile.settings.categories");
	const ts = useTranslations("mobile.status");
	const loading = useTranslations("mobile.activity")("loading");
	const { state, reload } = useCategories();
	const [editing, setEditing] = useState<Category | null>(null);
	const [open, setOpen] = useState(false);

	const show = (category: Category | null) => {
		setEditing(category);
		setOpen(true);
	};
	// The plus is the bar's: the system glass plus on iOS, a text plus on Android.
	const add = (
		<Stack.Screen
			options={{
				headerRight: () =>
					Platform.OS === "ios" ? (
						<AddButton label={t("addTitle")} onPress={() => show(null)} />
					) : (
						<Button
							accessibilityLabel={t("addTitle")}
							label="+"
							onPress={() => show(null)}
							variant="text"
						/>
					),
			}}
		/>
	);

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
	return (
		<>
			{add}
			<SettingsPage>
				<StaleNote since={state.staleSince} />
				<ListGroup>
					{all.map((category) => {
						const count = t("count", { count: category.expenseCount });
						return (
							<ListRow
								accessibilityLabel={`${category.name}, ${count}`}
								key={category.id}
								lead={<CategoryTile category={category} />}
								onPress={() => show(category)}
								sub={
									category.excludeByDefault ? (
										<StatusText
											label={`${count} · ${ts("notCounted")}`}
											size="sm"
											tone="muted"
										/>
									) : (
										count
									)
								}
								title={category.name}
							/>
						);
					})}
				</ListGroup>
			</SettingsPage>
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
