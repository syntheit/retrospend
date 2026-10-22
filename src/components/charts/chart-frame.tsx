"use client";

import { formatCompactAmount } from "@retrospend/domain/currency-format";
import { fromMinor } from "@retrospend/domain/money-minor";
import { useLocale } from "next-intl";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { formatMoney, type MoneyValue } from "~/components/money/format";
import { cn } from "~/lib/cn";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
	const q = window.matchMedia(REDUCE);
	q.addEventListener("change", onChange);
	return () => q.removeEventListener("change", onChange);
}

/**
 * Whether charts may animate (R24): off when the person asked for reduced
 * motion, and off on the server so the first paint never animates.
 */
export function useChartMotion(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => !window.matchMedia(REDUCE).matches,
		() => false,
	);
}

/**
 * A compact axis label ("2.5M") for a value in minor units. Axis ticks are
 * approximate by nature; every exact amount on a chart (tooltip, legend)
 * goes through the one money formatter instead.
 */
export function useAxisTick(currency: string) {
	const locale = useLocale();
	return useCallback(
		(minor: number) =>
			minor === 0
				? "0"
				: formatCompactAmount(
						Number(fromMinor({ minor: Math.round(minor), currency })),
						"",
						locale,
					),
		[currency, locale],
	);
}

/** Money as text for a chart's spoken summary, through the one formatter. */
export function useMoneyText() {
	const locale = useLocale();
	return useCallback(
		(value: MoneyValue) => formatMoney(value, { locale }) ?? "",
		[locale],
	);
}

/**
 * The frame every chart draws in: a fixed height, an accessible summary of
 * what the chart says (the one question in its title, with the numbers),
 * and the drawing hidden from the accessibility tree.
 */
export function ChartFrame({
	summary,
	height,
	children,
	className,
}: {
	summary: string;
	height: number;
	children: ReactNode;
	className?: string;
}) {
	return (
		<figure
			aria-label={summary}
			className={cn("relative m-0 w-full", className)}
			role="img"
			style={{ height }}
		>
			<div aria-hidden="true" className="size-full">
				{children}
			</div>
		</figure>
	);
}

/** The tooltip body: inverted like Tip, 12px, one label and one value. */
export function ChartTip({
	label,
	children,
}: {
	label?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="rounded-ctl bg-fg text-bg text-meta shadow-menu px-2 py-1 tabular-nums">
			{label != null && <span className="mr-2 opacity-80">{label}</span>}
			{children}
		</div>
	);
}
