"use client";

import { daysBetween } from "@retrospend/domain/format-date";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { PersonTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { formatMoney } from "~/components/money/format";
import { PersonRow } from "~/components/rows/person-row";
import { RowList } from "~/components/rows/row";
import { FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { faceOf } from "./standing";
import type { PersonSummary } from "./types";
import { personHrefOf } from "./use-person-actions";

export const targetOf = (p: PersonSummary): PersonTarget => ({
	id: p.person.key,
	name: p.person.name,
});

/** "3 days ago", "today": the last thing shared, as the row's subline says it. */
function useAgo(today: string) {
	const t = useTranslations("peoplePage.ago");
	return (date: string) => {
		const days = daysBetween(date, today);
		if (days <= 0) return t("today");
		if (days === 1) return t("yesterday");
		if (days < 7) return t("days", { count: days });
		if (days < 60) return t("weeks", { count: Math.round(days / 7) });
		return t("months", { count: Math.round(days / 30) });
	};
}

/**
 * The row's subline: what waits for you, a pending payment, then the last
 * thing shared and when. Amounts go through the one formatter.
 */
function useSubline(today: string) {
	const t = useTranslations("peoplePage.row");
	const locale = useLocale();
	const ago = useAgo(today);
	return (p: PersonSummary) => {
		const parts: string[] = [];
		if (p.needsYou) parts.push(t("needYou", { count: p.needsYou }));
		if (p.group === "pending" && p.pending) {
			const amount = formatMoney(p.pending.amount, { locale });
			parts.push(
				p.pending.direction === "out"
					? t("pendingOut", { amount, name: p.person.name })
					: t("pendingIn", { amount }),
			);
		}
		if (p.lastShared)
			parts.push(`${p.lastShared.title} · ${ago(p.lastShared.date)}`);
		return parts.join(" · ");
	};
}

/**
 * The balance the row shows: the net in the home currency. Without a net (a
 * currency has no rate) it shows the first currency as it is, never a
 * converted guess.
 */
const balanceOf = (p: PersonSummary) =>
	p.net ?? p.parts[0]?.amount ?? { minor: 0, currency: "USD" };

export function PeopleRows({
	people,
	handlersFor,
	today,
	label,
}: {
	people: PersonSummary[];
	handlersFor: (p: PersonSummary) => ActionHandlers<PersonTarget>;
	today: string;
	label: string;
}) {
	const sub = useSubline(today);
	return (
		<RowList label={label}>
			{people.map((p) => {
				const target = targetOf(p);
				const handlers = handlersFor(p);
				return (
					<ActionArea
						entity="person"
						handlers={handlers}
						key={p.person.key}
						target={target}
					>
						<PersonRow
							actions={
								<ActionMenu
									entity="person"
									handlers={handlers}
									target={target}
								/>
							}
							data-person={p.person.key}
							person={{
								id: p.person.key,
								name: p.person.name,
								imageUrl: p.person.imageUrl,
								onRetrospend: p.person.onRetrospend,
								lastShared: sub(p),
								balance: balanceOf(p),
								href: personHrefOf(p.person),
							}}
						/>
					</ActionArea>
				);
			})}
		</RowList>
	);
}

/** One group of the list: a heading with its count, then the rows. */
export function PeopleGroup({
	id,
	title,
	children,
	count,
}: {
	id: string;
	title: string;
	count: number;
	children: React.ReactNode;
}) {
	if (!count) return null;
	return (
		<section aria-labelledby={`people-${id}`} className="mb-6" data-group={id}>
			<h2
				className="text-fg text-section mb-1 flex items-baseline gap-2"
				id={`people-${id}`}
			>
				{title}
				<span className="text-fg-3 font-normal tabular-nums">{count}</span>
			</h2>
			{children}
		</section>
	);
}

/** Settled people: their faces and names, expanding into rows. */
export function SettledWall({
	people,
	handlersFor,
	today,
}: {
	people: PersonSummary[];
	handlersFor: (p: PersonSummary) => ActionHandlers<PersonTarget>;
	today: string;
}) {
	const t = useTranslations("peoplePage");
	const format = useFormatter();
	const [open, setOpen] = useState(false);
	const names = people.map((p) => p.person.name);
	const who =
		names.length > 3
			? t("settledWho", {
					first: names[0] ?? "",
					second: names[1] ?? "",
					count: names.length - 2,
				})
			: format.list(names, { type: "conjunction" });
	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<PeopleGroup count={people.length} id="settled" title={t("groups.settled")}>
			<Button
				aria-expanded={open}
				className="h-auto w-full justify-start gap-3 px-0 py-2"
				kind="ghost"
				onClick={() => setOpen((o) => !o)}
			>
				<FaceStack
					max={8}
					people={people.map((p) => faceOf(p.person))}
					size="sm"
				/>
				<span className="text-fg-2 text-small min-w-0 flex-1 truncate text-left">
					{who}
				</span>
				<Chevron aria-hidden="true" />
			</Button>
			{open && (
				<PeopleRows
					handlersFor={handlersFor}
					label={t("groups.settled")}
					people={people}
					today={today}
				/>
			)}
		</PeopleGroup>
	);
}
