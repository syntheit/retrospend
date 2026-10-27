"use client";

import { parseMoneyInput } from "@retrospend/domain/parse";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import type { ConvertDirection, CurrencyRow } from "./types";
import { useConvert } from "./use-convert";

/**
 * Convert: one amount of the stronger currency of the pair into the weaker
 * (the swap turns it around), and a result per rate type. The amount is
 * parsed here (the shared parser) and converted on the server.
 */
export function ConvertBlock({
	row,
	home,
}: {
	row: CurrencyRow;
	home: string;
}) {
	const t = useTranslations("currenciesPage.convert");
	const locale = useMoneyLocale();
	const tp = useTranslations("currenciesPage");
	const label = useRateLabel();
	const defaultPrice = row.defaultType
		? row.prices[row.defaultType]
		: undefined;
	const [direction, setDirection] = useState<ConvertDirection>(
		// The stronger currency is the one unit: from home when home is the base.
		defaultPrice?.base === home ? "fromHome" : "toHome",
	);
	const [text, setText] = useState("100");
	const from = direction === "toHome" ? row.code : home;
	const to = direction === "toHome" ? home : row.code;
	const parsed = parseMoneyInput(text, locale, from);
	const { result, failed } = useConvert(
		row.code,
		parsed.ok ? parsed.minor : null,
		direction,
	);
	return (
		<div>
			<div className="text-fg-2 text-small mb-1 font-semibold">
				{t("title")}
			</div>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<MoneyInput
						currency={from}
						onChange={(next) => setText(next)}
						value={text}
					/>
				</div>
				<Tip content={t("swap")}>
					<Button
						aria-label={t("swap")}
						icon
						kind="ghost"
						onClick={() => {
							setDirection((d) => (d === "toHome" ? "fromHome" : "toHome"));
						}}
					>
						<ArrowRightLeft />
					</Button>
				</Tip>
				<span className="text-body text-fg-2 shrink-0">
					{t("into", { code: to })}
				</span>
			</div>
			<div aria-live="polite" className="mt-2 flex flex-col">
				{failed ? (
					<p className="text-danger text-small">{t("failed")}</p>
				) : (
					(result ?? []).map((r) => (
						<div
							className="border-line flex items-baseline justify-between gap-3 border-t py-2 first:border-t-0"
							key={r.type}
						>
							<span className="text-body text-fg">
								{label(r.type)}
								{r.derived ? (
									<span className="text-fg-3 text-meta block">
										{tp("derived", { home })}
									</span>
								) : null}
							</span>
							<span className="text-body text-fg font-semibold">
								<Money value={r.value} />
							</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
