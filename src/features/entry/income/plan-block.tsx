"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { api, type RouterOutputs } from "~/trpc/react";

type Plan =
	RouterOutputs["wealth"]["income"]["add"]["preview"]["value"]["plan"];

/**
 * "Then your plan assigns": every line Use my plan writes, from the same
 * preview as What this changes (RC-5), and what stays Not planned yet.
 */
export function PlanBlock({ plan }: { plan: Plan }) {
	const t = useTranslations("entry.income");
	const month = api.envelope.getMonth.useQuery(
		{},
		{ enabled: plan.lines.length > 0 },
	);
	const names = new Map(
		(month.data?.groups ?? []).flatMap((g) =>
			g.envelopes.map((e) => [e.id, e.name] as const),
		),
	);
	const reason =
		plan.reason === "no_envelope_budget"
			? t("planNoBudget")
			: plan.reason === "other_currency"
				? t("planOtherCurrency", { currency: plan.rest?.currency ?? "" })
				: null;
	return (
		<section
			aria-live="polite"
			className="flex flex-col gap-1 border-line border-t pt-3"
			data-testid="entry-plan"
		>
			<h3 className="font-semibold text-body text-fg">{t("planTitle")}</h3>
			{reason ? <p className="text-fg-3 text-small">{reason}</p> : null}
			{plan.applied && plan.lines.length === 0 ? (
				<p className="text-fg-3 text-small">{t("planNone")}</p>
			) : null}
			{plan.lines.map((l) => (
				<div
					className="flex min-h-6 items-baseline justify-between gap-3 text-small"
					key={l.envelopeId}
				>
					<span className="text-fg-2">{names.get(l.envelopeId) ?? ""}</span>
					<Money
						figure={`preview.plan.${l.envelopeId}`}
						sign="exceptZero"
						value={l.amount}
					/>
				</div>
			))}
			{plan.rest ? (
				<div className="flex min-h-6 items-baseline justify-between gap-3 text-small">
					<span className="text-fg-2">{t("planStays")}</span>
					<Money figure="preview.plan.rest" value={plan.rest} />
				</div>
			) : null}
		</section>
	);
}
