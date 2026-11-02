"use client";

import { ChevronRight, SearchX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { AccountTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { seriesColor } from "~/components/charts/spec";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { cn } from "~/lib/cn";
import { Rows } from "./account-rows";
import { moveInOrder, sortAccounts, type WealthSort } from "./sort";
import type { WealthAccount, WealthGroup, WealthView } from "./types";

export type AccountFilters = {
	query: string;
	liquid: "liquid" | "illiquid" | null;
	foreign: boolean;
};

export const NO_FILTERS: AccountFilters = {
	query: "",
	liquid: null,
	foreign: false,
};

const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

/** Filters touch the list only; the headline numbers never change. */
export function matches(a: WealthAccount, f: AccountFilters, home: string) {
	if (f.query && !fold(a.name).includes(fold(f.query))) return false;
	if (f.liquid === "liquid" && !a.liquid) return false;
	if (f.liquid === "illiquid" && a.liquid) return false;
	if (f.foreign && a.amount.currency === home) return false;
	return true;
}

/** The group's identity dot: its series color (R19); liabilities stay hollow. */
function GroupDot({ series }: { series?: number }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"rounded-chip inline-block size-2 shrink-0",
				series ? null : "ring-fg-3 ring-1 ring-inset",
			)}
			style={series ? { background: seriesColor(series) } : undefined}
		/>
	);
}

function Group({
	group,
	series,
	children,
}: {
	group: WealthGroup;
	series?: number;
	children: React.ReactNode;
}) {
	const t = useTranslations("wealthPage");
	const liab = group.key === "liabilities";
	return (
		<section
			aria-labelledby={`group-${group.key}`}
			className={cn("mt-6", liab && "border-line-strong mt-8 border-t pt-4")}
		>
			<div className="mb-1 flex items-center gap-2">
				<h2
					className="text-fg text-section flex flex-1 items-center gap-2"
					id={`group-${group.key}`}
				>
					<GroupDot series={liab ? undefined : series} />
					{t(`groups.${group.key}`)}
				</h2>
				<span className="text-body text-fg font-semibold">
					<Money sign={liab ? "never" : undefined} value={group.total} />
				</span>
			</div>
			{children}
		</section>
	);
}

/** Account groups, then the collapsed closed accounts, or the empty states. */
export function AccountList({
	view,
	filters,
	sort,
	custom,
	onReorder,
	handlers,
	onOpen,
	onClear,
	onAdd,
}: {
	view: WealthView;
	filters: AccountFilters;
	sort: WealthSort;
	/** The saved custom order: account ids. */
	custom: readonly string[];
	/** The whole custom order after a drag. */
	onReorder: (order: string[]) => void;
	handlers: ActionHandlers<AccountTarget>;
	onOpen: (a: WealthAccount) => void;
	onClear: () => void;
	onAdd: () => void;
}) {
	const t = useTranslations("wealthPage");
	const locale = useLocale();
	const [showClosed, setShowClosed] = useState(false);
	const series = new Map(view.allocation.map((s) => [s.key, s.series]));
	if (!view.groups.length && !view.closed.length)
		return (
			<Empty
				action={
					<Button kind="primary" onClick={onAdd} size="sm">
						{t("addAccount")}
					</Button>
				}
				hint={t("empty.hint")}
				title={t("empty.title")}
			/>
		);
	const shown = view.groups
		.map((g) => ({
			...g,
			accounts: sortAccounts(
				g.accounts.filter((a) => matches(a, filters, view.home)),
				sort,
				locale,
				custom,
			),
		}))
		.filter((g) => g.accounts.length);
	const closed = sortAccounts(
		view.closed.filter((a) => matches(a, filters, view.home)),
		sort,
		locale,
		custom,
	);
	const all = [...view.groups.flatMap((g) => g.accounts), ...view.closed];
	return (
		<div>
			{shown.map((g) => (
				<Group group={g} key={g.key} series={series.get(g.key)}>
					<Rows
						accounts={g.accounts}
						handlers={handlers}
						label={t(`groups.${g.key}`)}
						onMove={
							sort === "custom"
								? (from, to) =>
										onReorder(
											moveInOrder(
												all,
												custom,
												locale,
												g.accounts.map((a) => a.id),
												from,
												to,
											),
										)
								: undefined
						}
						onOpen={onOpen}
					/>
				</Group>
			))}
			{!shown.length && !closed.length ? (
				<Empty
					action={
						<Button kind="secondary" onClick={onClear} size="sm">
							{t("filters.clear")}
						</Button>
					}
					hint={t("filters.noneHint")}
					icon={SearchX}
					title={t("filters.none")}
				/>
			) : null}
			{closed.length ? (
				<section aria-labelledby="closed-title" className="mt-8">
					<div className="mb-1 flex items-center gap-2">
						<h2 className="text-fg text-section flex-1" id="closed-title">
							<Button
								aria-controls="closed-list"
								aria-expanded={showClosed}
								className="text-section px-0"
								kind="ghost"
								onClick={() => setShowClosed((s) => !s)}
							>
								<ChevronRight
									aria-hidden="true"
									className={cn(
										"transition-transform duration-(--t-state)",
										showClosed && "rotate-90",
									)}
								/>
								{t("closed.title")}
								<span className="text-fg-3 font-normal tabular-nums">
									{closed.length}
								</span>
							</Button>
						</h2>
						<span className="text-fg-3 text-meta">
							{t("closed.notCounted")}
						</span>
					</div>
					<div hidden={!showClosed} id="closed-list">
						<Rows
							accounts={closed}
							handlers={handlers}
							label={t("closed.title")}
						/>
					</div>
				</section>
			) : null}
		</div>
	);
}
