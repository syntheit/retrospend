import {
	type ErrorBoundaryProps,
	Stack,
	useLocalSearchParams,
} from "expo-router";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { EntryDetail } from "@/features/activity/EntryView";
import { rowFromParam } from "@/features/activity/entryRow";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";

/**
 * One entry, read only, read from the server by its id. The row the list
 * passes only fills the view while the server answers, and only when it
 * reads as a row with this id: a link can carry anything.
 */
export default function EntryScreen() {
	const t = useTranslations("mobile.entry");
	const { id, row } = useLocalSearchParams<{ id: string; row?: string }>();
	const placeholder = useMemo(() => rowFromParam(row, id), [row, id]);

	return (
		<>
			<Stack.Screen options={{ title: t("title"), headerLargeTitle: false }} />
			<Screen>
				{id ? (
					<EntryDetail id={id} placeholder={placeholder} />
				) : (
					<EmptyState title={t("missing")} />
				)}
			</Screen>
		</>
	);
}

/** A view that fails to draw says so and offers to try again, instead of closing the app. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
	const t = useTranslations("mobile.entry");
	const tc = useTranslations("mobile.common");
	return (
		<Screen>
			<EmptyState
				actionLabel={tc("retry")}
				detail={t("loadErrorDetail")}
				onAction={() => void retry()}
				title={t("loadError")}
			/>
		</Screen>
	);
}
