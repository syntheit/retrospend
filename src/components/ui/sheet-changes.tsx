"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

/** One place that moves: its name, and what happens to it (a ChangeValue). */
export type ChangeLine = {
	key: string;
	label: ReactNode;
	value: ReactNode;
};

/**
 * SheetChanges (R30): the "What this changes" block of a money sheet (kit
 * `.am-chg`). A hairline, the heading, one line per place that moves (name
 * left, before or delta → after right), then one sentence for what was
 * checked and stays, and one for what could not be checked. The figures are
 * the server's dry run of the same write Save makes; the block only lays
 * them out. `status` stands in for the lines while there is nothing to show
 * yet (loading, an empty form, a reason it cannot be saved).
 */
export function SheetChanges({
	title,
	done = false,
	lines = [],
	stays: staysIn = [],
	unavailable: unavailableIn = [],
	status,
	children,
	className,
	testId,
}: {
	/** Overrides "What this changes" ("What this edit changes"). */
	title?: string;
	/** After the save: "What changed". */
	done?: boolean;
	lines?: readonly ChangeLine[];
	/** Names of the places checked that stay as they are. */
	stays?: readonly string[];
	/** Names of the places that could not be checked (a missing rate). */
	unavailable?: readonly string[];
	/** Shown instead of the lines: loading, nothing to show yet, cannot save. */
	status?: ReactNode;
	/** Lines the write itself states, before the figure lines. */
	children?: ReactNode;
	/** Replaces the hairline and spacing (a block that already sits under a rule). */
	className?: string;
	testId?: string;
}) {
	const t = useTranslations("kit.changes");
	const headingId = useId();
	const anyLine = lines.length > 0 || !!children;
	// One name per place, even when it moves in two currencies.
	const stays = [...new Set(staysIn)];
	const unavailable = [...new Set(unavailableIn)];
	return (
		<section
			aria-labelledby={headingId}
			aria-live="polite"
			className={className ?? "border-line flex flex-col gap-1 border-t pt-3"}
			data-slot="sheet-changes"
			data-testid={testId}
		>
			<h3 className="text-body text-fg font-semibold" id={headingId}>
				{title ?? (done ? t("titleDone") : t("title"))}
			</h3>
			{status != null ? (
				<p className="text-fg-3 text-small">{status}</p>
			) : (
				<>
					{children}
					{lines.map((l) => (
						<div
							className="text-small flex min-h-6 items-baseline justify-between gap-3"
							key={l.key}
						>
							<span className="text-fg-2">{l.label}</span>
							<span className="flex flex-wrap items-baseline justify-end gap-x-2 text-right">
								{l.value}
							</span>
						</div>
					))}
					{stays.length > 0 ? (
						<p className="text-fg-3 text-small">
							{!anyLine
								? t("noneChange", { list: stays.join(", ") })
								: stays.length === 1
									? t("nothingElseOne", { item: stays[0] ?? "" })
									: t("nothingElse", { list: stays.join(", ") })}
						</p>
					) : null}
					{unavailable.length > 0 ? (
						<p className="text-fg-3 text-meta">
							{t("unavailable", { list: unavailable.join(", ") })}
						</p>
					) : null}
				</>
			)}
		</section>
	);
}

/**
 * A line's value, in one of the kit's two readings. With `delta` (the Add
 * sheets, kit `.am-chg`): the change, then "→ after" muted. Without it (a
 * settlement, kit `.mx`): where it starts, muted, then "→ after" in 600.
 */
export function ChangeValue({
	from,
	delta,
	to,
}: {
	from?: ReactNode;
	delta?: ReactNode;
	to?: ReactNode;
}) {
	if (delta != null)
		return (
			<>
				<span>{delta}</span>
				{to != null ? (
					<span className="text-fg-3">
						{"→ "}
						{to}
					</span>
				) : null}
			</>
		);
	return (
		<>
			{from != null ? <span className="text-fg-3">{from}</span> : null}
			<span className="text-fg-3">→</span>
			<span className="text-fg font-semibold">{to}</span>
		</>
	);
}

/** The loading word, for callers that pass `status` while the dry run runs. */
export function useChangesLoading(): string {
	return useTranslations("kit.changes")("loading");
}
