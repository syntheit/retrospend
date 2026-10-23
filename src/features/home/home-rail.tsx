"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Section } from "~/components/layout/section";
import { useRowDates } from "~/components/rows/dates";
import { PersonRow } from "~/components/rows/person-row";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { CategoryTile } from "~/components/ui/category-badge";
import { sortPeople } from "~/features/people/filter";
import { personHrefOf } from "~/features/people/use-person-actions";
import { daysUntil, isDue } from "~/features/recurring/groups";
import { categoryOf } from "~/features/recurring/item-vm";
import { RecurringMoney } from "~/features/recurring/recurring-table";
import type {
	PeopleOverview,
	PersonSummary,
} from "~/server/services/people/types";
import type {
	RecurringItemDTO,
	RecurringView,
} from "~/server/services/recurring-view.service";

/** How far ahead Coming up looks, and how many rows each block shows (mockup). */
const AHEAD_DAYS = 21;
const MAX_UPCOMING = 5;
const MAX_OWED = 3;

/** Who owes you most, then who you owe most (People's balance sort). */
export function railPeople(
	view: PeopleOverview,
	locale: string,
): PersonSummary[] {
	const withNet = sortPeople(
		view.people.filter((p) => p.net),
		"balance",
		locale,
	);
	return [
		...withNet.filter((p) => p.group === "owed").slice(0, MAX_OWED),
		...withNet.filter((p) => p.group === "owe").slice(0, 1),
	];
}

/**
 * Upcoming recurring items in the next 3 weeks. Due and overdue ones are
 * Needs you items already, so they are left out here (a fact appears once).
 */
export function upcoming(view: RecurringView) {
	return view.items
		.filter(
			(r) => !r.paused && !isDue(r) && daysUntil(r, view.today) <= AHEAD_DAYS,
		)
		.sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : 0))
		.slice(0, MAX_UPCOMING);
}

function PeopleBlock({
	people,
	home,
}: {
	people: PersonSummary[];
	home: string;
}) {
	const t = useTranslations("homePage.rail");
	if (!people.length) return null;
	return (
		<Section
			action={{ label: t("allPeople"), href: "/people" }}
			id="rail-people"
			title={t("people")}
		>
			<RowList label={t("people")} variant="flat">
				{people.map((p) => (
					<PersonRow
						data-person={p.person.key}
						key={p.person.key}
						person={{
							id: p.person.key,
							name: p.person.name,
							imageUrl: p.person.imageUrl,
							onRetrospend: p.person.onRetrospend,
							lastShared: p.lastShared?.title ?? "",
							// railPeople keeps only people with a net.
							balance: p.net ?? { minor: 0, currency: home },
							href: personHrefOf(p.person),
						}}
					/>
				))}
			</RowList>
		</Section>
	);
}

function ComingUpBlock({
	items,
	today,
}: {
	items: RecurringItemDTO[];
	today: string;
}) {
	const t = useTranslations("homePage.rail");
	const other = useTranslations("activityRecurring");
	const router = useRouter();
	const { short } = useRowDates(today);
	return (
		<Section
			action={{ label: t("recurring"), href: "/activity/recurring" }}
			id="rail-coming-up"
			title={t("comingUp")}
		>
			{items.length ? (
				<RowList label={t("comingUp")} variant="flat">
					{items.map((r) => (
						// Recurring's own row anatomy (RecurringRow has no biweekly yet).
						<Row
							data-id={r.id}
							end={<RecurringMoney r={r} />}
							key={r.id}
							lead={<CategoryTile category={categoryOf(r, other("other"))} />}
							open={{
								label: r.title,
								onOpen: () => router.push("/activity/recurring"),
							}}
							sub={<RowSub parts={[short(r.next)]} />}
							title={r.title}
						/>
					))}
				</RowList>
			) : (
				<p className="text-fg-3 text-small">{t("nothingDue")}</p>
			)}
		</Section>
	);
}

/**
 * The desktop rail (R26): glanceable context that opens its page. People
 * with balances and what is coming up. The trip card and Envelopes to watch
 * wait for their sources (docs/ui/GAPS.md, Home). With nothing to show (a
 * new user) the rail steps aside and the main column takes the width.
 */
export function HomeRail({
	people,
	recurring,
}: {
	people: PeopleOverview | undefined;
	recurring: RecurringView | undefined;
}) {
	const t = useTranslations("homePage.rail");
	const locale = useLocale();
	const who = useMemo(
		() => (people ? railPeople(people, locale) : []),
		[people, locale],
	);
	const soon = useMemo(
		() => (recurring ? upcoming(recurring) : []),
		[recurring],
	);
	if (!who.length && !soon.length) return null;
	return (
		<aside
			aria-label={t("label")}
			className="flex min-w-0 shrink-0 flex-col max-lg:hidden lg:w-80"
		>
			<PeopleBlock home={people?.home ?? ""} people={who} />
			{recurring && <ComingUpBlock items={soon} today={recurring.today} />}
		</aside>
	);
}
