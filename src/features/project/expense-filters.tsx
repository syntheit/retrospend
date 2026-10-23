"use client";

import { useTranslations } from "next-intl";
import { Toolbar } from "~/components/layout/toolbar";
import { Face } from "~/components/ui/avatar-face";
import { FilterChip, FilterChips, FilterMenu } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { fold } from "~/features/projects/view-model";
import type { ExpenseRow, PageView } from "./types";

export type Filters = { query: string; review: boolean; paidBy: string | null };
export const NO_FILTERS: Filters = { query: "", review: false, paidBy: null };

/** The rows a filter keeps (search ignores case and accents). */
export function applyFilters(rows: readonly ExpenseRow[], f: Filters) {
	const q = fold(f.query.trim());
	return rows.filter(
		(r) =>
			(!q || fold(`${r.title} ${r.category?.name ?? ""}`).includes(q)) &&
			(!f.review || r.waiting === "review") &&
			(!f.paidBy || r.payerId === f.paidBy),
	);
}

export const isFiltered = (f: Filters) =>
	f.query !== "" || f.review || f.paidBy !== null;

/** One toolbar: search, To review, the chosen payer and the Filter menu with Paid by. */
export function ExpenseFilters({
	view,
	value: f,
	onChange,
}: {
	view: PageView;
	value: Filters;
	onChange: (f: Filters) => void;
}) {
	const t = useTranslations("projectV2.expenses");
	const toReview = view.expenses.filter((r) => r.waiting === "review").length;
	const payer = view.members.find((m) => m.id === f.paidBy);
	const face = (m: { imageUrl: string | null; name: string }) => (
		<Face imageUrl={m.imageUrl} name={m.name} size="xs" />
	);
	return (
		<Toolbar label={t("filters")}>
			<Input
				aria-label={t("search")}
				className="h-ctl w-60 max-md:w-full"
				onChange={(e) => onChange({ ...f, query: e.target.value })}
				placeholder={t("search")}
				type="search"
				value={f.query}
			/>
			<FilterChips>
				{toReview > 0 ? (
					<FilterChip
						onClick={() => onChange({ ...f, review: !f.review })}
						selected={f.review}
					>
						{t("toReview", { count: toReview })}
					</FilterChip>
				) : null}
				{payer ? (
					<FilterChip
						lead={face(payer)}
						onClick={() => onChange({ ...f, paidBy: null })}
						selected
					>
						{payer.isMe ? t("paidByYou") : t("paidBy", { name: payer.name })}
					</FilterChip>
				) : null}
				{view.solo ? null : (
					<FilterMenu
						groups={[
							{
								id: "paidBy",
								label: t("paidByGroup"),
								items: view.members.map((m) => ({
									id: m.id,
									label: m.isMe ? t("you") : m.name,
									lead: face(m),
									checked: f.paidBy === m.id,
								})),
							},
						]}
						onToggle={(_, id, on) => onChange({ ...f, paidBy: on ? id : null })}
					/>
				)}
			</FilterChips>
		</Toolbar>
	);
}
