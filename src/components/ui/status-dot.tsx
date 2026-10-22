"use client";

import { useTranslations } from "next-intl";
import { cn } from "~/lib/cn";

/**
 * The one status map (R5). Every status in the app is one of these kinds and
 * shows as a word plus a color, never color alone. StatusDot draws the dot
 * and the word; Badge draws the same kind as a pill. Words live in the `kit`
 * catalog (`kit.status.*`).
 */
export type StatusTone =
	| "positive"
	| "attention"
	| "info"
	| "danger"
	| "owe"
	| "quiet"
	| "muted";

export const STATUS = {
	owed: { tone: "positive", word: "owed" },
	owe: { tone: "owe", word: "owe" },
	settled: { tone: "muted", word: "settled" },
	funded: { tone: "positive", word: "funded" },
	underfunded: { tone: "attention", word: "underfunded" },
	overspent: { tone: "attention", word: "overspent" },
	pending: { tone: "info", word: "pending" },
	confirmed: { tone: "quiet", word: "confirmed" },
	overdue: { tone: "attention", word: "overdue" },
	due: { tone: "attention", word: "due" },
	review: { tone: "attention", word: "review" },
	importing: { tone: "info", word: "importing" },
	error: { tone: "danger", word: "error" },
	notOnRetrospend: { tone: "muted", word: "notOnRetrospend" },
	upcoming: { tone: "quiet", word: "upcoming" },
	noRate: { tone: "attention", word: "noRate" },
	rejected: { tone: "muted", word: "rejected" },
} as const satisfies Record<string, { tone: StatusTone; word: string }>;

export type StatusKind = keyof typeof STATUS;

/** Dot color, word color and pill fill for each tone. */
export const TONE: Record<
	StatusTone,
	{ dot: string; text: string; pill: string }
> = {
	positive: { dot: "bg-positive", text: "text-positive", pill: "bg-raised" },
	attention: {
		dot: "bg-attention",
		text: "text-attention-text",
		pill: "bg-attention-bg",
	},
	info: { dot: "bg-info", text: "text-info", pill: "bg-info-bg" },
	danger: { dot: "bg-danger", text: "text-danger", pill: "bg-danger-bg" },
	owe: { dot: "bg-fg-2", text: "text-owe", pill: "bg-raised" },
	quiet: { dot: "bg-fg-3", text: "text-fg-2", pill: "bg-raised" },
	muted: { dot: "bg-fg-3", text: "text-fg-3", pill: "bg-raised" },
};

/** The translated word of a status kind. */
export function useStatusWord(): (kind: StatusKind) => string {
	const t = useTranslations("kit.status");
	return (kind) => t(STATUS[kind].word);
}

export function StatusDot({
	kind,
	label,
	size = "default",
	className,
}: {
	kind: StatusKind;
	/** Overrides the map's word with a more specific one ("Overdue since Oct 3"). */
	label?: string;
	size?: "default" | "sm";
	className?: string;
}) {
	const word = useStatusWord();
	const tone = TONE[STATUS[kind].tone];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-2 whitespace-nowrap",
				size === "sm" ? "text-meta" : "text-small",
				tone.text,
				className,
			)}
			data-status={kind}
		>
			<span
				aria-hidden="true"
				className={cn("size-2 shrink-0 rounded-full", tone.dot)}
			/>
			{label ?? word(kind)}
		</span>
	);
}
