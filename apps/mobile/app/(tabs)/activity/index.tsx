import { useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityRow } from "@/features/activity/ActivityRow";
import {
	type ActivityState,
	createActivitySource,
	loadActivity,
} from "@/features/activity/source";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListDetail } from "@/ui/ListDetail";

export default function ActivityScreen() {
	const t = useTranslations("mobile.activity");
	const { api, local } = useSession();
	const { color } = useTheme();
	const [state, setState] = useState<ActivityState>({ status: "loading" });
	const source = useMemo(() => (api ? createActivitySource(api) : null), [api]);

	useEffect(() => {
		if (!source || !local) return;
		let cancelled = false;
		loadActivity(source, local.cache, (cached) => {
			if (!cancelled) setState(cached);
		}).then((next) => {
			if (!cancelled) setState(next);
		});
		return () => {
			cancelled = true;
		};
	}, [source, local]);

	const list =
		state.status === "ready" && state.items.length > 0 ? (
			<FlatList
				contentInsetAdjustmentBehavior="automatic"
				data={state.items}
				keyExtractor={(item) => item.id}
				renderItem={({ item }) => <ActivityRow item={item} />}
				style={{ backgroundColor: color.bg }}
			/>
		) : (
			<EmptyState
				detail={
					state.status === "unavailable"
						? t("unavailableDetail")
						: state.status === "error"
							? t("errorDetail")
							: undefined
				}
				title={
					state.status === "loading"
						? t("loading")
						: state.status === "unavailable"
							? t("unavailable")
							: state.status === "error"
								? t("error")
								: t("empty")
				}
			/>
		);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			<AccountTopBar title={t("title")} />
			<ListDetail detail={<EmptyState title={t("pick")} />} list={list} />
		</View>
	);
}
