"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { GlanceStrip } from "~/components/glance/glance-strip";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useRowDates } from "~/components/rows/dates";
import { useRateTypeName } from "~/features/people/rate-type";
import type { GlanceDTO } from "~/server/services/figures/glance";
import type { PeopleOverview } from "~/server/services/people/types";
import { api } from "~/trpc/react";
import {
	type DollarLabel,
	type OwedFaces,
	toGlanceVM,
	unnamedMissingRates,
} from "./glance-vm";
import { HomeRail, type OwedTotals } from "./home-rail";
import { GlanceSkeleton, PartUnavailable } from "./home-states";
import { NeedsSection } from "./needs-section";
import { namedRates } from "./needs-vm";
import { RECENT_INPUT } from "./recent-input";
import { RecentSection } from "./recent-section";
import { useHomeRefresh } from "./use-home-refresh";

/** The faces behind Owed to you and You owe, in People's groups (rule 8). */
export function owedFaces(view: PeopleOverview | undefined): OwedFaces {
	const of = (group: "owed" | "owe") =>
		(view?.people ?? [])
			.filter((p) => p.group === group)
			.map((p) => ({
				id: p.person.key,
				name: p.person.name,
				imageUrl: p.person.imageUrl,
			}));
	return { owedToYou: of("owed"), youOwe: of("owe") };
}

/** The glance, or its loading and unavailable states, and the rates it leaves out. */
function GlancePart({
	data,
	pending,
	onRetry,
	named,
	faces,
}: {
	data: GlanceDTO | undefined;
	pending: boolean;
	onRetry: () => void;
	named: string[];
	faces: OwedFaces;
}) {
	const t = useTranslations("homePage");
	const rateName = useRateTypeName();
	const { short } = useRowDates(data?.today);
	// The rate's own day shows only when it is older than today.
	const dollarLabel = useCallback<DollarLabel>(
		(type, date, today) =>
			date === today
				? rateName(type)
				: t("dollarOlder", { type: rateName(type), date: short(date) }),
		[rateName, short, t],
	);
	const vm = useMemo(
		() => (data ? toGlanceVM(data, { named, faces, dollarLabel }) : null),
		[data, named, faces, dollarLabel],
	);
	if (pending) return <GlanceSkeleton />;
	if (!data || !vm) return <PartUnavailable onRetry={onRetry} />;
	const missing = unnamedMissingRates(data, named);
	return (
		<div data-glance="">
			<GlanceStrip glance={vm} rowsBeside />
			{missing.length > 0 && (
				<p className="text-fg-3 text-small mt-2">
					{t("missingRates", { currencies: missing.join(", ") })}
				</p>
			)}
		</div>
	);
}

/**
 * Home (uiV2): the glance (one hero, spent this month), then Needs you and
 * Recent, with a rail of people and what is coming up on wide screens
 * (R26). Every number is the server's; each part loads and fails alone.
 */
export function HomeScreen() {
	const t = useTranslations("homePage");
	useHomeRefresh();
	const glance = api.home.glance.useQuery();
	const needs = api.home.needsYou.useQuery();
	const recent = api.expense.listV2.useQuery(RECENT_INPUT);
	const people = api.people.overview.useQuery();
	const recurring = api.recurring.listView.useQuery();
	const today = glance.data?.today ?? needs.data?.today;
	const { long } = useRowDates();
	const named = useMemo(
		() => (needs.data ? namedRates(needs.data) : []),
		[needs.data],
	);
	const faces = useMemo(() => owedFaces(people.data), [people.data]);
	const totals = useMemo<OwedTotals>(
		() => ({
			owedToYou: glance.data?.owedToYou.value ?? null,
			youOwe: glance.data?.youOwe.value ?? null,
		}),
		[glance.data],
	);

	return (
		<PageFrame label="home">
			<PageHeader sub={today ? long(today) : undefined} title={t("title")} />
			<GlancePart
				data={glance.data}
				faces={faces}
				named={named}
				onRetry={() => void glance.refetch()}
				pending={glance.isPending}
			/>
			<div className="mt-8 lg:flex lg:items-start lg:gap-12">
				<div className="min-w-0 flex-1">
					<NeedsSection
						failed={needs.isError}
						list={needs.data}
						loading={needs.isPending}
						onRetry={() => void needs.refetch()}
					/>
					<RecentSection
						failed={recent.isError}
						loading={recent.isPending}
						onRetry={() => void recent.refetch()}
						rows={recent.data?.items}
						today={recent.data?.today ?? today}
					/>
				</div>
				<HomeRail
					people={people.data}
					recurring={recurring.data}
					totals={totals}
				/>
			</div>
		</PageFrame>
	);
}
