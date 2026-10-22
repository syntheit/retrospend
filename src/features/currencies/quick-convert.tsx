"use client";

import { parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import type { ConvertDirection, CurrencyRow } from "./types";
import { useConvert } from "./use-convert";

const QUERY =
	/^\s*([\d.,\s]+?)\s*([a-z]{3,5})(?:\s+(?:to|in|en|a|para|nach|vers|в)\s+([a-z]{3,5}))?\s*$/i;

export type ConvQuery = {
	code: string;
	from: string;
	to: string;
	minor: number;
	direction: ConvertDirection;
};

/**
 * Reads "100 usd", "100 usd to ars" or "50000 ars to brl" from the search
 * field. One side must be the home currency: the server converts through
 * it. Null for anything else (the field is then a plain search).
 */
export function readConvQuery(
	q: string,
	home: string,
	rows: readonly CurrencyRow[],
	locale: string,
): ConvQuery | null {
	const m = QUERY.exec(q);
	if (!m?.[1] || !m[2]) return null;
	const from = m[2].toUpperCase();
	const to = m[3]?.toUpperCase() ?? (from === home ? null : home);
	if (!to || from === to || (from !== home && to !== home)) return null;
	const code = from === home ? to : from;
	if (!rows.some((r) => r.code === code && r.types.length)) return null;
	const amount = parseMoneyInput(m[1].trim(), locale, from);
	if (!amount.ok) return null;
	return {
		code,
		from,
		to,
		minor: amount.minor,
		direction: from === home ? "fromHome" : "toHome",
	};
}

/** The search field's converter card: every rate type, from the server. */
export function QuickConvert({ query }: { query: ConvQuery }) {
	const t = useTranslations("currenciesPage.convert");
	const label = useRateLabel();
	const { result } = useConvert(query.code, query.minor, query.direction);
	return (
		<section aria-live="polite" className="mb-4 max-w-130">
			<h2 className="text-body text-fg mb-1 font-semibold">
				{t.rich("quickTitle", {
					amount: () => (
						<Money value={{ minor: query.minor, currency: query.from }} />
					),
					to: query.to,
				})}
			</h2>
			{(result ?? []).map((r) => (
				<div
					className="border-line flex items-baseline justify-between gap-3 border-t py-2"
					key={r.type}
				>
					<span className="text-body text-fg-2">{label(r.type)}</span>
					<span className="text-body text-fg font-semibold">
						<Money value={r.value} />
					</span>
				</div>
			))}
		</section>
	);
}
