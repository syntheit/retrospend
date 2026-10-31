"use client";

import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import { SkeletonRows } from "~/components/ui/skeleton";
import { toTransactionVM } from "~/features/activity/to-vm";
import { api } from "~/trpc/react";

const RECENT = 5;

/**
 * Your expenses in one currency: what you spent in it in all (its own
 * figure first, the home equivalent second), the latest few, and a link to
 * Activity filtered by the currency. Spending comes from the one spending
 * definition on the server; the rows are the ones Activity shows.
 */
export function CurrencyExpenses({ code }: { code: string }) {
	const t = useTranslations("currenciesPage.expenses");
	const row = useTranslations("activity.row");
	const types = useTranslations("activity.rateTypes");
	const spending = api.exchangeRate.spending.useQuery(
		{ currency: code },
		{ staleTime: 30_000 },
	);
	const recent = api.expense.listV2.useQuery(
		{ currencies: [code], kinds: ["expense"], limit: RECENT },
		{ staleTime: 30_000 },
	);
	const s = spending.data;
	const rows = recent.data?.items;
	const href = `/activity?${new URLSearchParams({ currency: code, range: "all" })}`;

	let body: React.ReactNode;
	if (spending.isError || recent.isError)
		body = <p className="text-danger text-small">{t("failed")}</p>;
	else if (!s || !rows) body = <SkeletonRows count={3} />;
	else if (s.count === 0 && rows.length === 0)
		body = <p className="text-fg-3 text-small">{t("empty", { code })}</p>;
	else
		body = (
			<>
				<dl>
					<div className="flex items-baseline justify-between gap-3 py-1">
						<dt className="text-body text-fg-2">
							{t("total", { count: s.count })}
						</dt>
						<dd className="text-body text-fg font-semibold">
							<Money value={s.original} />
						</dd>
					</div>
					{s.home !== s.currency ? (
						<div className="flex items-baseline justify-between gap-3 py-1">
							<dt className="text-body text-fg-2">
								{t("inHome", { home: s.home })}
							</dt>
							<dd className="text-body text-fg-2">
								<Money missing="noRate" value={s.inHome} />
							</dd>
						</div>
					) : null}
				</dl>
				{rows.length ? (
					<div className="mt-2">
						<RowList label={t("recent")}>
							{rows.map((r) => (
								<TransactionRow
									data-id={r.id}
									key={r.id}
									showDate
									today={recent.data?.today}
									tx={toTransactionVM(
										r,
										(p) =>
											row(p.direction === "sent" ? "paidTo" : "paidYou", {
												name: p.counterparty,
											}),
										(type) =>
											row("rate", {
												type: types.has(type) ? types(type) : type,
											}),
									)}
								/>
							))}
						</RowList>
					</div>
				) : null}
			</>
		);

	return (
		<Section
			action={s && s.count > 0 ? { label: t("seeAll"), href } : undefined}
			id="currency-expenses"
			title={t("title", { code })}
		>
			{body}
		</Section>
	);
}
