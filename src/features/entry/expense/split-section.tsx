"use client";

import { formatPercent } from "@retrospend/domain/format-percent";
import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { Minus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Tip } from "~/components/ui/tooltip";
import { type SplitRef, splitKey } from "~/lib/shared-split-input";
import { FieldError } from "../shared-ui";
import type { EntryPerson } from "../types";
import {
	amountLeft,
	type CustomBy,
	type ExpenseDraft,
	pctLeft,
	type SplitChoice,
} from "./draft";
import { CustomHead, SplitRow } from "./split-rows";

type Draft = ReturnType<typeof import("./use-expense-draft").useExpenseDraft>;

/**
 * Paid by, Split (Evenly / X owes all / Custom) and one row per person with
 * a face and a share. Custom picks By amount, percent or shares in a select
 * (R7: no second segmented); the header says what is left.
 */
export function SplitSection(p: {
	x: Draft;
	you: EntryPerson;
	shares: ReadonlyMap<string, number> | null;
	showErrors: boolean;
	splitError: boolean;
}) {
	const t = useTranslations("entry.expense");
	const { d } = p.x;
	const people: EntryPerson[] = [
		...(d.youIncluded ? [p.you] : []),
		...d.others,
	];
	const payers =
		d.outsidePayer &&
		!people.some((x) => splitKey(x) === splitKey(d.outsidePayer!))
			? [...people, d.outsidePayer]
			: people;
	const nameOf = (r: SplitRef) =>
		splitKey(r) === splitKey(p.you)
			? t("you")
			: (payers.find((x) => splitKey(x) === splitKey(r))?.name ?? "");
	const other = d.others[0];
	const canFull = d.youIncluded && d.others.length === 1 && other;
	const youPaid = splitKey(d.paidBy) === splitKey(p.you);
	const options: { value: SplitChoice; label: string }[] = [
		{ value: "even", label: t("evenly") },
		...(canFull
			? [
					{
						value: "full" as const,
						label: youPaid
							? t("owesAll", { name: other.name.split(" ")[0] ?? other.name })
							: t("youOweAll"),
					},
				]
			: []),
		{ value: "custom", label: t("custom") },
	];
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-start gap-3">
				<div className="flex min-w-0 flex-col gap-2">
					<span className="text-fg-2 text-small font-medium">
						{t("paidBy")}
					</span>
					<Select
						onValueChange={(key) => {
							const hit = payers.find((x) => splitKey(x) === key);
							if (hit)
								p.x.setPayer({
									participantType: hit.participantType,
									participantId: hit.participantId,
								});
						}}
						value={splitKey(d.paidBy)}
					>
						<SelectTrigger aria-label={t("paidBy")} className="min-w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{payers.map((x) => (
								<SelectItem key={splitKey(x)} value={splitKey(x)}>
									<Face imageUrl={x.avatarUrl} name={x.name} size="xs" />
									{splitKey(x) === splitKey(p.you) ? t("you") : x.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="text-fg-2 text-small font-medium">{t("split")}</span>
					<Segmented
						full
						label={t("split")}
						onChange={p.x.setSplit}
						options={options}
						value={d.split === "full" && !canFull ? "even" : d.split}
					/>
				</div>
			</div>
			{d.split === "custom" ? (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<Select onValueChange={(v) => p.x.setBy(v as CustomBy)} value={d.by}>
						<SelectTrigger aria-label={t("by.label")} className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(["amount", "pct", "shares"] as const).map((b) => (
								<SelectItem key={b} value={b}>
									{t(`by.${b}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<CustomHead d={d} you={p.you} />
				</div>
			) : null}
			<ul className="flex flex-col">
				{people.map((person) => (
					<SplitRow
						d={d}
						key={splitKey(person)}
						nameOf={nameOf}
						person={person}
						share={p.shares?.get(splitKey(person)) ?? null}
						x={p.x}
						you={p.you}
					/>
				))}
				{d.outsidePayer && splitKey(d.paidBy) === splitKey(d.outsidePayer) ? (
					<li className="border-line flex min-h-11 items-center gap-3 border-b">
						<Face
							imageUrl={d.outsidePayer.avatarUrl}
							name={d.outsidePayer.name}
							size="sm"
						/>
						<span className="text-body min-w-0 flex-1">
							{d.outsidePayer.name}
							<span className="text-fg-3 text-meta block">
								{t("rowPaid")} · {t("noShare")}
							</span>
						</span>
					</li>
				) : null}
			</ul>
			{p.showErrors && p.splitError ? (
				<FieldError
					text={d.by === "pct" ? t("error.splitPct") : t("error.splitAmount")}
				/>
			) : null}
		</div>
	);
}
