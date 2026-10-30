import { dayKey } from "@retrospend/domain/time-zone";
import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useCategories } from "@/features/activity/useCategories";
import { useAddEntry } from "@/features/entry/AddEntryProvider";
import { subscribeEntryChanges } from "@/features/entry/events";
import { usePeopleOverview } from "@/features/people/usePeople";
import { SectionHeader, StaleNote } from "@/ui/List";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { CashflowSection } from "./CashflowSection";
import { InsightsToolbar } from "./InsightsToolbar";
import { MonthBars } from "./MonthBars";
import { RankedList } from "./RankedList";
import { type CategoryInfo, categoryRows } from "./rows";
import { SummaryLead } from "./SummaryLead";
import { fetchInsights } from "./source";
import { useInsightsWords } from "./useInsightsWords";
import {
	DEFAULT_VIEW,
	INSIGHTS_PREFIX,
	type InsightsView,
	isNarrowed,
	viewKey,
} from "./view";
import { YtdSection } from "./YtdSection";

/** Views kept on the phone for offline reading; the oldest go first. */
const KEEP = 8;

/**
 * Insights (insights.html, the web's Activity > Insights): one total, then
 * where it went (by category), the year so far against last year, how it
 * moved month by month and what came in. Every figure is the server's
 * (GET /figures/insights/*); this screen only formats and draws.
 */
export function InsightsScreen() {
	const t = useTranslations("mobile.insights");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const { open } = useAddEntry();
	const { space } = useTheme();
	const [view, setView] = useState<InsightsView>(DEFAULT_VIEW);
	const today = useMemo(() => dayKey(new Date()), []);
	const words = useInsightsWords(today);
	const fetch = useMemo(
		() => (api ? fetchInsights(api, view, today) : null),
		[api, view, today],
	);
	const { state, reload } = useCachedRead(
		{ name: viewKey(view, today), schema: 1 },
		fetch,
		{ prefix: INSIGHTS_PREFIX, keep: KEEP },
	);
	// An entry added, undone or sent from the outbox changes every figure.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);

	const categories = useCategories();
	const people = usePeopleOverview();
	const categoryList =
		categories.state.status === "ready" ? categories.state.data : [];
	const peopleList =
		people.state.status === "ready" ? people.state.data.people : [];
	const refs = useMemo(
		() =>
			new Map<string, CategoryInfo>(
				categoryList.map((c) => [
					c.id,
					{ name: c.name, icon: c.icon, tone: c.tone },
				]),
			),
		[categoryList],
	);
	const categoryChoices = useMemo(
		() => categoryList.map((c) => ({ id: c.id, label: c.name })),
		[categoryList],
	);
	const peopleChoices = useMemo(
		() => peopleList.map((p) => ({ id: p.person.key, label: p.person.name })),
		[peopleList],
	);
	// The chips' picks by name; a pick the lists do not hold is left out.
	const names = [
		categoryChoices.find((c) => c.id === view.categoryId)?.label,
		peopleChoices.find((p) => p.id === view.personKey)?.label,
	]
		.filter(Boolean)
		.join(", ");
	const narrowed = isNarrowed(view);

	let body: React.ReactNode;
	if (state.status === "loading") {
		body = <EmptyState title={tc("loading")} />;
	} else if (state.status === "error") {
		body = (
			<EmptyState
				actionLabel={tc("retry")}
				detail={t("errorDetail")}
				onAction={() => void reload()}
				title={t("error")}
			/>
		);
	} else {
		const { summary, months, ytd, cashflow, span } = state.data;
		const named = summary.missingRates;
		body =
			summary.count === 0 ? (
				narrowed ? (
					<EmptyState
						actionLabel={tc("clearFilters")}
						detail={t("empty.filteredHint")}
						onAction={() =>
							setView({ ...view, categoryId: null, personKey: null })
						}
						title={t("empty.filtered")}
					/>
				) : (
					<EmptyState
						actionLabel={t("empty.add")}
						detail={t("empty.rangeHint")}
						onAction={() => open("expense")}
						title={t("empty.range")}
					/>
				)
			) : (
				<>
					<StaleNote since={state.staleSince} />
					<SummaryLead
						allTime={view.period === "all"}
						names={names}
						summary={summary}
						words={words}
					/>
					<SectionHeader
						detail={String(summary.categories.length)}
						title={t("category.title")}
					/>
					<RankedList
						rows={categoryRows(summary.categories, refs, view.compare)}
						words={words}
					/>
					<YtdSection data={ytd} named={named} refs={refs} words={words} />
					<SectionHeader title={t("months.title")} />
					<MonthBars data={months} rangeEnd={span.to} words={words} />
					{cashflow ? (
						<CashflowSection data={cashflow} named={named} words={words} />
					) : null}
				</>
			);
	}

	return (
		<>
			<Stack.Screen options={{ title: t("title"), headerLargeTitle: false }} />
			<Screen flush>
				<View style={{ paddingTop: space[2] }}>
					<InsightsToolbar
						categories={categoryChoices}
						onChange={setView}
						people={peopleChoices}
						view={view}
					/>
				</View>
				{body}
			</Screen>
		</>
	);
}
