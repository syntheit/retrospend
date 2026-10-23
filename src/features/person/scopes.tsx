"use client";

import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Balance } from "~/components/money/balance";
import { Row, RowList } from "~/components/rows/row";
import { StatusDot } from "~/components/ui/status-dot";
import type { PaymentDTO, PersonPage } from "~/features/people/types";
import { cn } from "~/lib/cn";
import { PaymentRow } from "./ledger-rows";

export const scopeKey = (s: PersonPage["scopes"][number]) =>
	s.project?.id ?? "none";

/**
 * Projects with this person: one row per project (and Outside projects)
 * with its own balance lines. A row scopes the list below and Settle up;
 * the same row again shows everything.
 */
export function Scopes({
	page,
	scope,
	onScope,
}: {
	page: PersonPage;
	scope: string | null;
	onScope: (scope: string | null) => void;
}) {
	const t = useTranslations("personPage.scopes");
	if (page.scopes.length < 2) return null;
	return (
		<Section id="person-projects" title={t("title")}>
			<RowList label={t("title")}>
				{page.scopes.map((s) => {
					const key = scopeKey(s);
					const on = scope === key;
					const name = s.project?.name || t("outside");
					return (
						<Row
							className={cn(on && "bg-raised")}
							data-scope={key}
							end={
								s.lines.length ? (
									s.lines.map((l) => <Balance amount={l} key={l.currency} />)
								) : (
									<StatusDot kind="settled" size="sm" />
								)
							}
							key={key}
							open={{
								onOpen: () => onScope(on ? null : key),
								label: on ? t("showAll", { name }) : t("showOnly", { name }),
							}}
							title={name}
						/>
					);
				})}
			</RowList>
		</Section>
	);
}

/** The latest payments with this person, newest first (desktop right column). */
export function LatestPayments({
	payments,
	page,
}: {
	payments: readonly PaymentDTO[];
	page: PersonPage;
}) {
	const t = useTranslations("personPage");
	if (!payments.length) return null;
	return (
		<section aria-labelledby="person-payments">
			<h2
				className="text-fg-2 text-small mb-1 flex justify-between font-semibold"
				id="person-payments"
			>
				{t("payments")}
				<span className="text-fg-3 font-normal tabular-nums">
					{payments.length}
				</span>
			</h2>
			<RowList label={t("payments")}>
				{payments.slice(0, 5).map((y) => (
					<PaymentRow key={y.id} payment={y} person={page.person} />
				))}
			</RowList>
		</section>
	);
}
