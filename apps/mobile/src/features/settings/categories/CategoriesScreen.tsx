import { Stack } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { AddButton } from "@/ui/AddButton";
import { EmptyState } from "@/ui/EmptyState";
import { CategoryTile, ListGroup, ListRow, StaleNote } from "@/ui/List";
import { RowMenu } from "@/ui/RowMenu";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { StatusText } from "@/ui/StatusText";
import { useToast } from "@/ui/Toast";
import { TopBarAction } from "@/ui/TopBarAction";
import { SettingsPage } from "../parts";
import { useCategories } from "../useSettings";
import { CategorySheet } from "./CategorySheet";
import type { Category } from "./source";

/**
 * The categories list: each with its tile, its name and how many expenses
 * use it, then "Not counted in spending" when it is left out of totals. Tap
 * one to rename, recolor or change its icon; a long press opens its menu, which
 * also switches whether it counts in spending (with Undo). The plus in the bar adds one. Deleting and
 * merging are on the web.
 */
export function CategoriesScreen() {
	const t = useTranslations("mobile.settings.categories");
	const ts = useTranslations("mobile.status");
	const tc = useTranslations("mobile.common");
	const { state, reload } = useCategories();
	const { api } = useSession();
	const toast = useToast();
	const [editing, setEditing] = useState<Category | null>(null);
	const [open, setOpen] = useState(false);

	const show = (category: Category | null) => {
		setEditing(category);
		setOpen(true);
	};
	// Whether the category counts in spending, switched from its menu. The
	// toast carries Undo, which puts the old setting back.
	async function setCounted(category: Category, counted: boolean) {
		if (!api) return;
		const write = (excludeByDefault: boolean) =>
			api.categories.update(
				{ id: category.id, excludeByDefault },
				{ context: { idempotencyKey: newClientId() } },
			);
		try {
			await write(!counted);
			void reload();
			toast.show({
				message: t("saved", { name: category.name }),
				undo: {
					label: tc("undo"),
					onUndo: () => {
						void write(!category.excludeByDefault).then(() => void reload());
					},
				},
			});
		} catch {
			toast.show({ message: t("saveError") });
		}
	}

	// The plus is the bar's: the system glass plus on iOS, the plus icon on Android.
	const add = (
		<Stack.Screen
			options={{
				headerRight: () =>
					Platform.OS === "ios" ? (
						<AddButton label={t("addTitle")} onPress={() => show(null)} />
					) : (
						<TopBarAction
							icon="Plus"
							id="add"
							label={t("addTitle")}
							onPress={() => show(null)}
						/>
					),
			}}
		/>
	);

	if (state.status !== "ready") {
		return (
			<Screen>
				{state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={() => void reload()}
						title={t("error")}
					/>
				) : (
					<SkeletonRows />
				)}
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
							<RowMenu
								items={[
									{
										id: "rename",
										label: t("menu.rename"),
										onPress: () => show(category),
									},
									{
										id: "icon",
										label: t("menu.iconColor"),
										onPress: () => show(category),
									},
									{
										id: "count",
										label: category.excludeByDefault
											? t("menu.count")
											: t("menu.uncount"),
										onPress: () =>
											void setCounted(category, category.excludeByDefault),
									},
								]}
								key={category.id}
								onPress={() => show(category)}
								title={category.name}
							>
								<ListRow
									accessibilityLabel={`${category.name}, ${count}`}
									lead={<CategoryTile category={category} />}
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
							</RowMenu>
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
