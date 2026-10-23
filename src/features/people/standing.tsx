"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	BalanceBar,
	type BalanceSegment,
} from "~/components/charts/balance-bar";
import { Money } from "~/components/money/money";
import { FaceStack } from "~/components/ui/avatar-face";
import { useIsMobile } from "~/hooks/use-mobile";
import type { PeopleOverview, PersonSummary } from "./types";

/** The face a bar segment and a stack use for a person. */
export const faceOf = (p: PersonSummary["person"]) => ({
	id: p.key,
	name: p.name,
	imageUrl: p.imageUrl,
});

/**
 * A bar segment takes you to the person's row: it scrolls into view and
 * its link takes the focus, so Enter opens the person.
 */
function toRow(person: { id: string }) {
	const row = document.querySelector<HTMLElement>(
		`[data-person="${CSS.escape(person.id)}"]`,
	);
	if (!row) return;
	row.scrollIntoView({ block: "center", behavior: "smooth" });
	row.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
}

/**
 * Where you stand (Direction A, D1): Owed to you and You owe as two figures,
 * never netted, then the bar of the people who make them up and how many
 * there are. A currency without a rate is named as not in the totals.
 */
export function Standing({
	view,
	owed,
	owe,
	settled,
}: {
	view: PeopleOverview;
	owed: PersonSummary[];
	owe: PersonSummary[];
	settled: PersonSummary[];
}) {
	const t = useTranslations("peoplePage.standing");
	const phone = useIsMobile();
	if (!owed.length && !owe.length)
		return (
			<section aria-label={t("label")} className="mb-8 flex flex-col gap-3">
				<h2 className="text-fg text-title flex items-center gap-2">
					<CircleCheck aria-hidden="true" className="text-positive size-5" />
					{t("allSettled")}
				</h2>
				<FaceStack
					max={12}
					people={settled.map((p) => faceOf(p.person))}
					size="default"
				/>
			</section>
		);
	const byKey = new Map(view.people.map((p) => [p.person.key, p.person]));
	const segments: BalanceSegment[] = view.segments.flatMap((s) => {
		const person = byKey.get(s.key);
		return person
			? [
					{
						person: faceOf(person),
						direction: s.direction,
						share: s.share,
						amount: s.amount,
					},
				]
			: [];
	});
	const zero = { minor: 0, currency: view.home };
	// The totals convert other currencies at today's rates: they read "≈".
	const approx = view.people.some((p) =>
		p.parts.some((part) => part.amount.currency !== view.home),
	);
	return (
		<section aria-label={t("label")} className="mb-8">
			<div className="flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-2">
				<div>
					<div className="text-fg-2 text-small">{t("owedToYou")}</div>
					<Money
						approx={approx}
						className="text-positive text-hero max-md:text-title"
						figure="owed.owedToYou"
						missing="noRate"
						value={view.owedToYou}
					/>
				</div>
				<div className="text-right max-md:flex max-md:items-baseline max-md:justify-between max-md:text-left">
					<div className="text-fg-2 text-small">{t("youOwe")}</div>
					<Money
						approx={approx}
						className="text-owe text-title max-md:text-section"
						figure="owed.youOwe"
						missing="noRate"
						value={view.youOwe}
					/>
				</div>
			</div>
			{segments.length > 0 && (
				<div className="mt-3">
					<BalanceBar
						onSegment={toRow}
						owedToYou={view.owedToYou ?? zero}
						phone={phone}
						segments={segments}
						youOwe={view.youOwe ?? zero}
					/>
				</div>
			)}
			<div className="text-fg-3 text-meta mt-2 flex justify-between gap-4">
				<span>{t("peopleOweYou", { count: owed.length })}</span>
				{owe.length > 0 && (
					<span>{t("youOwePeople", { count: owe.length })}</span>
				)}
			</div>
			{view.unpriced.length > 0 && (
				<p className="text-fg-3 text-meta mt-1">
					{t("noRate", { currencies: view.unpriced.join(", ") })}
				</p>
			)}
		</section>
	);
}
