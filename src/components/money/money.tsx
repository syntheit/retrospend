"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import {
	type FormatMoneyOptions,
	formatMoney,
	type MoneyValue,
} from "./format";

type MoneyProps = {
	/** The amount the server computed (R9). Null: no amount (a muted word). */
	value: MoneyValue | null;
	display?: FormatMoneyOptions["display"];
	sign?: FormatMoneyOptions["sign"];
	cents?: FormatMoneyOptions["cents"];
	/** What a missing amount says ("No rate yet" for a missing conversion). */
	missing?: "none" | "noRate";
	className?: string;
};

/**
 * One amount through the one formatter (R10): tabular, lining figures, never
 * wrapped or truncated (7+ digit ARS, 0.004 ETH), leading minus. The client
 * formats what it gets and never converts, sums or rounds (R9).
 */
function MoneyAmount({
	value,
	display = "code",
	sign = "auto",
	cents = "auto",
	missing = "none",
	className,
}: MoneyProps) {
	const locale = useLocale();
	const t = useTranslations("kit.money");
	if (!value)
		return (
			<span className={cn("whitespace-nowrap text-fg-3", className)}>
				{t(missing)}
			</span>
		);
	return (
		<span
			className={cn("whitespace-nowrap tabular-nums", className)}
			data-currency={value.currency}
		>
			{formatMoney(value, { locale, display, sign, cents })}
		</span>
	);
}

/**
 * Money.pair: a foreign amount, the original first and the home amount
 * second, muted (R10). `inline` puts them on one line (a sheet, a glance
 * line); the default stacks them right-aligned (a row's money column). The
 * tip names the rate behind the conversion ("USD 1 = ARS 1,412 · Official ·
 * Oct 21"). Same currency: one amount.
 */
function MoneyPair({
	original,
	home,
	inline = false,
	tip,
	className,
}: {
	original: MoneyValue;
	/** Null when there is no rate yet: says so instead of a number. */
	home: MoneyValue | null;
	inline?: boolean;
	tip?: ReactNode;
	className?: string;
}) {
	if (home && home.currency === original.currency)
		return <MoneyAmount className={className} value={original} />;
	const pair = (
		<span
			className={cn(
				inline
					? "inline-flex items-baseline justify-end gap-2"
					: "inline-flex flex-col items-end",
				className,
			)}
			data-slot="money-pair"
		>
			<MoneyAmount value={original} />
			<MoneyAmount
				className={cn("text-fg-3", inline ? "text-small" : "text-meta")}
				missing="noRate"
				value={home}
			/>
		</span>
	);
	return tip ? <Tip content={tip}>{pair}</Tip> : pair;
}

/** `<Money value={...} />` and `<Money.pair original={...} home={...} />`. */
export const Money = Object.assign(MoneyAmount, { pair: MoneyPair });
