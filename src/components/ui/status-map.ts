/**
 * The one status map (R5). Every status in the app is one of these kinds and
 * shows as a word plus a color, never color alone. StatusDot draws it as a
 * dot and the word, Badge as a pill, Balance and AvailablePill take their
 * colors from it. Words live in the `kit` catalog (`kit.status.<word>`).
 * Plain data, no hooks, so server components can read it.
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
	notCounted: { tone: "muted", word: "notCounted" },
} as const satisfies Record<string, { tone: StatusTone; word: string }>;

export type StatusKind = keyof typeof STATUS;

/**
 * Per tone: the dot, the word, a pill fill and a pill edge. Positive never
 * fills (money to you is text with a word); attention, info and danger fill
 * with their soft background.
 */
export const TONE: Record<
	StatusTone,
	{ dot: string; text: string; pill: string; edge: string }
> = {
	positive: {
		dot: "bg-positive",
		text: "text-positive",
		pill: "bg-raised",
		edge: "border-positive/55",
	},
	attention: {
		dot: "bg-attention",
		text: "text-attention-text",
		pill: "bg-attention-bg",
		edge: "border-attention/55",
	},
	info: {
		dot: "bg-info",
		text: "text-info",
		pill: "bg-info-bg",
		edge: "border-info/55",
	},
	danger: {
		dot: "bg-danger",
		text: "text-danger",
		pill: "bg-danger-bg",
		edge: "border-danger/55",
	},
	owe: {
		dot: "bg-fg-2",
		text: "text-owe",
		pill: "bg-raised",
		edge: "border-line-strong",
	},
	quiet: {
		dot: "bg-fg-3",
		text: "text-fg-2",
		pill: "bg-raised",
		edge: "border-line-strong",
	},
	muted: {
		dot: "bg-fg-3",
		text: "text-fg-3",
		pill: "bg-raised",
		edge: "border-line-strong",
	},
};

/** The look of a status kind. */
export const toneOf = (kind: StatusKind) => TONE[STATUS[kind].tone];
