"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import {
	type FormatMoneyOptions,
	figureAttrs,
	formatMoney,
	formatMoneyPair,
	type MoneyValue,
} from "./format";

type Format = Omit<FormatMoneyOptions, "locale">;

/** What a missing amount says: "None", or "No rate yet" for a missing conversion. */
type Missing = "none" | "noRate";

type MoneyProps = Format & {
	/** The amount the server computed (R9). Null: no amount, a muted word. */
	value: MoneyValue | null;
	missing?: Missing;
	/** The figures registry key of this number, for the e2e audit. */
	figure?: string;
	/**
	 * A converted figure (a net across currencies at today's rates): it reads
	 * "≈ ARS 1,234" so nobody takes it for an exact amount (people.html).
	 */
	approx?: boolean;
	className?: string;
};

/**
 * One amount through the one formatter (R10): tabular, lining figures, never
 * wrapped or truncated (7+ digit ARS, 0.004 ETH), leading minus. The client
 * formats what it gets and never converts, sums or rounds (R9). Every amount
 * carries data-figure, data-minor and data-currency for the figure audit.
 */
function MoneyAmount({
	value,
	display,
	sign,
	cents,
	compact,
	missing = "none",
	figure,
	approx = false,
	className,
}: MoneyProps) {
	const locale = useLocale();
	const t = useTranslations("kit.money");
	const text = formatMoney(value, { locale, display, sign, cents, compact });
	return (
		<span
			className={cn(
				"whitespace-nowrap",
				text == null ? "text-fg-3" : "tabular-nums",
				className,
			)}
			data-slot="money"
			{...figureAttrs(figure, value)}
		>
			{text == null ? t(missing) : approx ? `≈ ${text}` : text}
		</span>
	);
}

/**
 * Money.pair: a foreign amount, the original first and the home amount
 * second, muted (R10). `inline` puts them on one line (a sheet, a glance
 * line); the default stacks them right-aligned (a row's money column). The
 * tip names the rate behind the conversion ("USD 1 = ARS 1,412 · Official ·
 * Oct 21"). Same currency: one amount. No home amount: "No rate yet".
 */
function MoneyPair({
	original,
	home,
	inline = false,
	tip,
	figure,
	homeFigure,
	className,
	...format
}: Format & {
	original: MoneyValue;
	/** Null when there is no rate yet: says so instead of a number. */
	home: MoneyValue | null;
	inline?: boolean;
	tip?: ReactNode;
	figure?: string;
	homeFigure?: string;
	className?: string;
}) {
	const locale = useLocale();
	const t = useTranslations("kit.money");
	const pair = formatMoneyPair(original, home, { locale, ...format });
	const same = home != null && pair.home == null;
	const first = (
		<span
			className="whitespace-nowrap tabular-nums"
			data-slot="money"
			{...figureAttrs(figure, original)}
		>
			{pair.original}
		</span>
	);
	if (same)
		return (
			<span className={className} data-slot="money-pair">
				{first}
			</span>
		);
	const body = (
		<span
			className={cn(
				inline
					? "inline-flex items-baseline justify-end gap-2"
					: "inline-flex flex-col items-end",
				className,
			)}
			data-slot="money-pair"
		>
			{first}
			<span
				className={cn(
					"whitespace-nowrap text-fg-3 tabular-nums",
					inline ? "text-small" : "text-meta",
				)}
				data-slot="money"
				{...figureAttrs(homeFigure, home)}
			>
				{pair.home ?? t("noRate")}
			</span>
		</span>
	);
	return tip ? <Tip content={tip}>{body}</Tip> : body;
}

/** `<Money value={...} />` and `<Money.pair original={...} home={...} />`. */
export const Money = Object.assign(MoneyAmount, { pair: MoneyPair });
