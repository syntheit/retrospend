"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PaceLine, type PaceSeries } from "~/components/charts/pace-line";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";

/** The line under the hero, picked by the server from the same figures. */
export type GlanceLine =
	| { kind: "perDay"; perDay: MoneyValue; daysLeft: number }
	| { kind: "leftToday"; left: MoneyValue }
	| { kind: "over"; over: MoneyValue }
	| { kind: "noBudget" };

export type GlanceRow = {
	id: "toAssign" | "owedToYou" | "youOwe" | "netWorth";
	amount: MoneyValue;
	href: string;
	/** The figures registry key. */
	figure?: string;
};

export type GlanceVM = {
	/** ISO date in the month ("2026-10-01"). */
	month: string;
	spent: MoneyValue;
	spentFigure?: string;
	line: GlanceLine;
	/** The server's pace verdict; shows the word when true. */
	fasterThanPlanned: boolean;
	pace: PaceSeries;
	/** Only the rows with something to say; zero rows are left out by the server. */
	rows: GlanceRow[];
};

const TONE: Partial<Record<GlanceRow["id"], string>> = {
	toAssign: "text-attention-text",
	owedToYou: "text-positive",
};

/** The glance line under the hero, never fixed copy. */
function useLine() {
	const t = useTranslations("glance.line");
	return (line: GlanceLine) => {
		switch (line.kind) {
			case "perDay":
				return t.rich("perDay", {
					amount: () => <Money value={line.perDay} />,
					days: line.daysLeft,
				});
			case "leftToday":
				return t.rich("leftToday", {
					amount: () => <Money value={line.left} />,
				});
			case "over":
				return t.rich("over", { amount: () => <Money value={line.over} /> });
			case "noBudget":
				return t("noBudget");
		}
	};
}

/**
 * GlanceStrip: Home's answer to "am I OK?". One hero (spent this month),
 * one line under it, the pace line, then only the rows with something to
 * say, each linking to its page. Variant B is the compact number strip.
 * Owed to you and You owe are two rows, never netted (D1).
 *
 * It lays itself out by its own width (container breakpoints): the pace
 * line moves beside the hero from 576px, and B's strip is a 2 by 2 grid
 * below that, so a phone column and a narrow rail both read well.
 */
export function GlanceStrip({
	glance,
	variant = "A",
}: {
	glance: GlanceVM;
	variant?: "A" | "B";
}) {
	const t = useTranslations("glance");
	const { month } = useRowDates();
	const line = useLine()(glance.line);
	const name = month(glance.month);
	const lead = (
		<div>
			<div className="text-fg-2 text-small">
				{t("spentIn", { month: name })}
			</div>
			<Money
				className={cn("text-fg mt-0.5 mb-1 block font-semibold", "text-hero")}
				figure={glance.spentFigure}
				value={glance.spent}
			/>
			<div className="text-fg-2 text-small">{line}</div>
			{variant === "A" && glance.fasterThanPlanned && (
				<StatusDot kind="overspent" label={t("faster")} size="sm" />
			)}
		</div>
	);
	if (variant === "B")
		return (
			<div className="@container">
				{lead}
				<div className="mt-4 grid grid-cols-2 gap-y-2 @xl:auto-cols-fr @xl:grid-flow-col @xl:grid-cols-none @xl:gap-y-0">
					{glance.rows.map((r, i) => (
						<Link
							className={cn(
								"border-line flex min-w-0 flex-col gap-0.5 py-1 pr-2",
								i % 2 === 1 && "border-l pl-4",
								i > 0 && "@xl:border-l @xl:pl-4",
								i >= 2 && "@max-xl:border-t @max-xl:pt-2",
							)}
							href={r.href}
							key={r.id}
						>
							<span className="text-fg-2 text-small truncate">
								{t(`row.${r.id}`)}
							</span>
							<Money
								className="text-body @xl:text-section font-semibold"
								figure={r.figure}
								value={r.amount}
							/>
						</Link>
					))}
				</div>
			</div>
		);
	return (
		<div className="@container">
			<div className="grid items-end gap-x-8 gap-y-2 @xl:grid-cols-[1fr_minmax(180px,360px)]">
				{lead}
				<PaceLine
					currentLabel={name}
					pace={glance.pace}
					previousLabel={t("lastMonth")}
				/>
				<div className="text-fg-3 text-meta col-span-full flex gap-4">
					<span className="inline-flex items-center gap-2">
						<span aria-hidden="true" className="bg-ds-accent h-0.5 w-3" />
						{name}
					</span>
					<span className="inline-flex items-center gap-2">
						<span aria-hidden="true" className="bg-fg-3 h-0.5 w-3" />
						{t("lastMonth")}
					</span>
				</div>
			</div>
			<ul className="mt-3 flex flex-col">
				{glance.rows.map((r) => (
					<li className="border-line border-t" key={r.id}>
						<Link
							className="min-h-row text-fg-2 focus-visible:outline-brand flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2"
							href={r.href}
						>
							<span className="flex-1">{t(`row.${r.id}`)}</span>
							<Money
								className={cn(
									"text-body font-semibold",
									TONE[r.id] ?? "text-fg",
								)}
								figure={r.figure}
								value={r.amount}
							/>
							<ChevronRight aria-hidden="true" className="text-fg-3 size-4" />
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
