import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { EntryView } from "@/features/activity/EntryView";
import type { ActivityItem } from "@/features/activity/source";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";

/**
 * One entry, read only. The list passes the row it already has (so the view
 * opens at once, offline too); a link with no row has nothing to show yet.
 */
export default function EntryScreen() {
	const t = useTranslations("mobile.entry");
	const { row } = useLocalSearchParams<{ id: string; row?: string }>();
	const item = useMemo<ActivityItem | null>(() => {
		try {
			return row ? (JSON.parse(row) as ActivityItem) : null;
		} catch {
			return null;
		}
	}, [row]);

	return (
		<>
			<Stack.Screen options={{ title: t("title"), headerLargeTitle: false }} />
			<Screen>
				{item ? <EntryView item={item} /> : <EmptyState title={t("missing")} />}
			</Screen>
		</>
	);
}
