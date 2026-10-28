import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { subscribeEntryChanges } from "@/features/entry/events";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { GALLERY_ENABLED } from "@/lib/flags";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { BudgetBody } from "./BudgetBody";
import { BudgetSheets, type OpenSheet } from "./BudgetSheets";
import { devSheet } from "./devSheet";
import { monthInfo } from "./months";
import { SetupSheet } from "./SetupSheet";
import {
	BUDGET_CACHE_KEEP,
	BUDGET_CACHE_PREFIX,
	budgetCache,
	fetchBudget,
} from "./source";

/**
 * The Budget tab: the month's verdict, the envelopes by group, and the sheets
 * that change them. Reads come from the phone's cache first; money writes go
 * through the server's preview and end in an Undo toast, so they need the
 * network.
 */
export function BudgetView() {
	const t = useTranslations("mobile.budget");
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const { widthClass } = useLayoutClass();
	// null is the current month; a number is a month the person stepped to.
	const [selected, setSelected] = useState<number | null>(null);
	const [seenOpen, setSeenOpen] = useState<number | null>(null);
	const [sheet, setSheet] = useState<OpenSheet | null>(null);
	const [setupOpen, setSetupOpen] = useState(false);

	const fetch = useMemo(
		() => (api ? fetchBudget(api, selected) : null),
		[api, selected],
	);
	const { state, reload } = useCachedRead(budgetCache(selected), fetch, {
		prefix: BUDGET_CACHE_PREFIX,
		keep: BUDGET_CACHE_KEEP,
	});
	// An expense added, undone or sent from the outbox moves every envelope.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);

	const data = state.status === "ready" ? state.data.month : null;
	useEffect(() => {
		if (data?.month.state === "OPEN") setSeenOpen(data.month.key);
	}, [data]);

	const info = data
		? monthInfo(data.month, data.book.startMonth, seenOpen)
		: null;

	// Gallery builds only: the screenshot tour names a sheet in the route.
	const { sheet: devName } = useLocalSearchParams<{ sheet?: string }>();
	// biome-ignore lint/correctness/useExhaustiveDependencies: opens once per route change
	useEffect(() => {
		if (GALLERY_ENABLED && devName === "setup") setSetupOpen(true);
		if (GALLERY_ENABLED && devName && data) setSheet(devSheet(devName, data));
	}, [devName, data !== null]);

	return (
		<>
			<AccountTopBar title={t("title")} />
			<Screen flush>
				{state.status === "loading" ? (
					<EmptyState title={loading} />
				) : state.status === "error" ? (
					<EmptyState detail={t("errorDetail")} title={t("error")} />
				) : !data || !info ? (
					<EmptyState
						actionLabel={t("setup.open")}
						detail={t("noBudgetDetail")}
						onAction={() => setSetupOpen(true)}
						title={t("noBudget")}
					/>
				) : data.book.paused ? (
					<EmptyState
						actionLabel={t("resume")}
						detail={t("pausedDetail")}
						onAction={() =>
							void api?.budget
								.resume({}, { context: { idempotencyKey: newClientId() } })
								.then(() => reload())
								.catch(() => undefined)
						}
						title={t("paused")}
					/>
				) : (
					<BudgetBody
						bounds={info.bounds}
						data={data}
						kind={info.kind}
						onOpen={setSheet}
						onSelectMonth={setSelected}
						payoff={state.data.payoff}
						stale={state.staleSince}
						wide={widthClass !== "compact"}
					/>
				)}
			</Screen>
			<SetupSheet
				onClose={() => setSetupOpen(false)}
				onDone={() => void reload()}
				visible={setupOpen}
			/>
			{data && info && !data.book.paused ? (
				<BudgetSheets
					data={data}
					kind={info.kind}
					onClose={() => setSheet(null)}
					onDone={() => void reload()}
					onOpen={setSheet}
					sheet={sheet}
				/>
			) : null}
		</>
	);
}
