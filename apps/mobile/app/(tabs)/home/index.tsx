import { router } from "expo-router";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityRow } from "@/features/activity/ActivityRow";
import { Glance } from "@/features/home/Glance";
import { NeedsYou } from "@/features/home/NeedsYou";
import { fetchHome, HOME_CACHE } from "@/features/home/source";
import { SectionHeader, StaleNote } from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";

export default function HomeScreen() {
	const t = useTranslations("mobile.home");
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchHome(api) : null), [api]);
	const { state } = useCachedRead(HOME_CACHE, fetch);

	return (
		<>
			<AccountTopBar title={t("title")} />
			<Screen flush>
				{state.status === "ready" ? (
					<>
						<StaleNote since={state.staleSince} />
						<Glance glance={state.data.glance} />
						<NeedsYou list={state.data.needs} />
						<SectionHeader
							actionLabel={t("recent.seeAll")}
							onAction={() => router.navigate("/activity")}
							title={t("recent.title")}
						/>
						{state.data.recent.items.length === 0 ? (
							<EmptyState title={t("recent.empty")} />
						) : (
							state.data.recent.items.map((item) => (
								<ActivityRow
									item={item}
									key={item.id}
									onPress={() =>
										router.navigate({
											pathname: "/activity/[id]",
											params: { id: item.id, row: JSON.stringify(item) },
										})
									}
								/>
							))
						)}
					</>
				) : state.status === "error" ? (
					<EmptyState detail={t("errorDetail")} title={t("error")} />
				) : null}
			</Screen>
		</>
	);
}
