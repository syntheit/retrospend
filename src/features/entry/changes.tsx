"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import type { MoneyDTO } from "./shared-ui";

export interface FigureChange {
	readonly id: string;
	readonly currency: string;
	readonly before: MoneyDTO | null;
	readonly after: MoneyDTO | null;
	readonly delta: MoneyDTO;
}

export interface PreviewDiff {
	readonly changes: readonly FigureChange[];
	readonly unchanged: readonly { id: string }[];
	readonly unavailable: readonly {
		id: string;
		before: unknown;
		after: unknown;
	}[];
}

/** The order places are listed in (kit changesHTML). */
const ORDER = [
	"accounts.balance",
	"notTracked",
	"owed.owedToYou",
	"owed.youOwe",
	"envelope.left",
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"spent",
	"netWorth",
];
/** Parts of net worth's 30-day breakdown: the net worth line already says it. */
const HIDDEN = /^netWorthChange\./;
/** Budget figures read null on both sides when there is no envelope budget: not applicable, not unknown. */
const BUDGET = /^budget\./;

const rank = (id: string) => {
	const i = ORDER.indexOf(id);
	return i < 0 ? ORDER.length : i;
};

/**
 * What this changes (R30): each place that moves, before to after, then what
 * was checked and stays, then what could not be checked. The block renders
 * the server's dry run of the same write Save makes, so it cannot differ
 * from the result. `byDesign` adds places a move never touches by rule
 * (expenses never touch accounts, N75) when the diff does not list them.
 */
export function ChangesBlock({
	diff,
	empty,
	loading,
	edit,
	byDesign = [],
	cannot,
	hide = [],
	rows,
}: {
	diff: PreviewDiff | null | undefined;
	empty: string;
	loading?: boolean;
	edit?: boolean;
	byDesign?: readonly string[];
	cannot?: string | null;
	/** Figures another line in the block already states (a transfer's accounts). */
	hide?: readonly string[];
	/** Lines the write's own result states, before the figure lines. */
	rows?: React.ReactNode;
}) {
	const t = useTranslations("entry.changes");
	// Figure ids have dots, which message keys cannot.
	const name = (id: string) => {
		const key = `figures.${id.replaceAll(".", "_")}`;
		return t.has(key) ? t(key as "figures.spent") : id;
	};
	const inline = (id: string) => {
		const key = `figuresInline.${id.replaceAll(".", "_")}`;
		return t.has(key) ? t(key as "figuresInline.spent") : name(id);
	};
	const body = () => {
		if (cannot)
			return (
				<p className="text-fg-3 text-small">
					{t("cannot", { reason: cannot })}
				</p>
			);
		if (!diff)
			return (
				<p className="text-fg-3 text-small">{loading ? t("loading") : empty}</p>
			);
		const changes = diff.changes
			.filter((c) => !HIDDEN.test(c.id) && !hide.includes(c.id))
			.slice()
			.sort((a, b) => rank(a.id) - rank(b.id));
		const moved = new Set(changes.map((c) => c.id));
		const stays = [
			...byDesign.filter(
				(id) =>
					!(
						id === "accounts" &&
						(moved.has("accounts.balance") || moved.has("netWorth"))
					),
			),
			...diff.unchanged.map((u) =>
				u.id === "accounts.balance" ? "accounts" : u.id,
			),
		].filter((id) => !HIDDEN.test(id) && !moved.has(id) && !hide.includes(id));
		const unknown = diff.unavailable.filter(
			(u) =>
				!HIDDEN.test(u.id) &&
				!(BUDGET.test(u.id) && u.before == null && u.after == null),
		);
		// Names inside a sentence come from their own keys: a language decides its case (German nouns).
		const list = [...new Set(stays)].map(inline);
		const anyLine = changes.length > 0 || !!rows;
		return (
			<>
				{rows}
				{changes.map((c) => (
					<div
						className="flex min-h-6 items-baseline justify-between gap-3 text-small"
						key={`${c.id}-${c.currency}`}
					>
						<span className="text-fg-2">{name(c.id)}</span>
						<span className="flex items-baseline gap-2 text-right">
							<Money
								figure={`preview.${c.id}.delta`}
								sign="exceptZero"
								value={c.delta}
							/>
							{c.after ? (
								<span className="text-fg-3">
									{"→ "}
									<Money figure={`preview.${c.id}.after`} value={c.after} />
								</span>
							) : null}
						</span>
					</div>
				))}
				{list.length > 0 ? (
					<p className="text-fg-3 text-small">
						{!anyLine
							? t("noneChange", { list: list.join(", ") })
							: list.length === 1
								? t("nothingElseOne", { item: list[0] ?? "" })
								: t("nothingElse", { list: list.join(", ") })}
					</p>
				) : null}
				{unknown.length > 0 ? (
					<p className="text-fg-3 text-meta">
						{t("unavailable", {
							list: unknown.map((u) => inline(u.id)).join(", "),
						})}
					</p>
				) : null}
			</>
		);
	};
	return (
		<section
			aria-live="polite"
			className="flex flex-col gap-1 border-line border-t pt-3"
			data-testid="entry-changes"
		>
			<h3 className="font-semibold text-body text-fg">
				{edit ? t("titleEdit") : t("title")}
			</h3>
			{body()}
		</section>
	);
}
