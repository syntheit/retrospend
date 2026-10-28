import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { subscribeEntryChanges } from "@/features/entry/events";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { BudgetBody } from "./BudgetBody";
import { BudgetSheets, type OpenSheet } from "./BudgetSheets";
import { monthInfo } from "./months";
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

	return (
		<>
			<AccountTopBar title={t("title")} />
			<Screen flush>
				{state.status === "loading" ? (
					<EmptyState title={loading} />
				) : state.status === "error" ? (
					<EmptyState detail={t("errorDetail")} title={t("error")} />
				) : !data || !info ? (
					<EmptyState detail={t("noBudgetDetail")} title={t("noBudget")} />
				) : data.book.paused ? (
					<EmptyState detail={t("pausedDetail")} title={t("paused")} />
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
