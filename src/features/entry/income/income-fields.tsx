"use client";

import {
	CalendarDays,
	ArrowDownToLine,
	ListChecks,
	MoreHorizontal,
	Tag,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AnswerLine, type AnswerPart } from "~/components/ui/answer-line";
import type { DetailTab } from "~/components/ui/detail-pager";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Switch } from "~/components/ui/switch";
import { useCategoryName } from "~/hooks/use-category-name";
import { AccountPills } from "../account-pills";
import { ComposerFrame } from "../composer-frame";
import { CategoryPanel } from "../expense/category-panel";
import { useDays } from "../expense/expense-answers";
import { WhenPanel } from "../expense/expense-panels";
import { type EntryCatalog, Field, FieldError } from "../shared-ui";
import { SourceField } from "./source-field";
import { IncomeAmount } from "./income-amount";
import { GlyphPill } from "~/components/ui/glyph-pill";
import { FilterChips } from "~/components/ui/chip";
import { PlanBlock } from "./plan-block";
import type { useIncome } from "./use-income";

type TabId = "category" | "when" | "into" | "plan" | "more";

/**
 * Add income on the composer frame (design D): amount and From on the left
 * with the answer line, the tabs Category, When, Into, Plan (only with an
 * envelope budget) and More on the right. The money layer (useIncome, the
 * preview, save and Undo) is the caller's; this is the view.
 */
export function IncomeFields({
	x,
	catalog,
	today,
	tried,
	changes,
}: {
	x: ReturnType<typeof useIncome>;
	catalog: EntryCatalog;
	today: string;
	tried: boolean;
	changes: React.ReactNode;
}) {
	const t = useTranslations("entry.income");
	const te = useTranslations("entry.expense");
	const { d } = x;
	const { displayName } = useCategoryName();
	const { days, dayLabel } = useDays(today);
	const [tab, setTab] = useState<TabId>("category");
	const err = (k: keyof typeof x.errors) => tried && x.errors[k];
	const planTab = x.hasBudget && !x.kept;
	const category = catalog.categories.find((c) => c.id === d.categoryId);
	// A save with no category goes to where it is picked.
	useEffect(() => {
		if (tried && x.errors.category) setTab("category");
	}, [tried, x.errors.category]);

	const tip = (name: string, key: number) => t("tabs.tip", { name, key });
	const tabs: (DetailTab & { id: TabId })[] = [
		{
			id: "category",
			label: t("tabs.category"),
			icon: <Tag aria-hidden="true" />,
			tip: tip(t("tabs.category"), 1),
			dot: !!d.categoryId,
			panel: (
				<div className="flex flex-col gap-2">
					<CategoryPanel
						categories={catalog.categories}
						kind="INCOME"
						onPick={(id) => x.set({ categoryId: id })}
						recents={catalog.recentCategoryIds}
						value={d.categoryId}
					/>
					{err("category") ? <FieldError text={t("error.category")} /> : null}
				</div>
			),
		},
		{
			id: "when",
			label: t("tabs.when"),
			icon: <CalendarDays aria-hidden="true" />,
			tip: tip(t("tabs.when"), 2),
			dot: d.date !== today,
			panel: (
				<WhenPanel
					date={d.date}
					dayLabel={dayLabel}
					days={days}
					onDate={(date) => x.set({ date })}
					today={today}
				/>
			),
		},
		{
			id: "into",
			label: t("tabs.into"),
			icon: <ArrowDownToLine aria-hidden="true" />,
			tip: tip(t("tabs.into"), 3),
			dot: !!d.into,
			panel: (
				<div className="flex flex-col gap-4">
					<AccountPills
						label={t("into")}
						none={t("noAccountMenu")}
						onChange={(id) => x.set({ into: id, keep: null })}
						places={catalog.places.filter((p) => !p.liability)}
						value={d.into}
					/>
					{x.account ? (
						<Segmented
							label={t("whereItGoes")}
							onChange={(v) => x.set({ keep: v === "keep" })}
							options={[
								{ value: "budget", label: t("yourBudget") },
								{ value: "keep", label: t("keepInWealth") },
							]}
							value={x.kept ? "keep" : "budget"}
						/>
					) : null}
				</div>
			),
		},
		...(planTab
			? [
					{
						id: "plan",
						label: t("tabs.plan"),
						icon: <ListChecks aria-hidden="true" />,
						tip: tip(t("tabs.plan"), 4),
						dot: !x.usePlan,
						panel: (
							<div className="flex flex-col gap-4">
								<FilterChips label={t("afterSaving")}>
									<GlyphPill
										onClick={() => x.set({ usePlan: true })}
										selected={x.usePlan}
									>
										{t("usePlan")}
									</GlyphPill>
									<GlyphPill
										onClick={() => x.set({ usePlan: false })}
										selected={!x.usePlan}
									>
										{t("notPlanned")}
									</GlyphPill>
								</FilterChips>
								{x.preview && x.usePlan ? (
									<PlanBlock plan={x.preview.value.plan} />
								) : null}
							</div>
						),
					} satisfies DetailTab & { id: TabId },
				]
			: []),
		{
			id: "more",
			label: t("tabs.more"),
			icon: <MoreHorizontal aria-hidden="true" />,
			tip: tip(t("tabs.more"), planTab ? 5 : 4),
			dot: !!d.note || d.repeats,
			panel: (
				<div className="flex flex-col gap-4">
					<Field htmlFor="income-note" label={t("note")}>
						<Input
							id="income-note"
							onChange={(e) => x.set({ note: e.target.value })}
							value={d.note}
						/>
					</Field>
					<div className="flex items-center justify-between gap-3">
						<span className="text-body text-fg">{t("repeats")}</span>
						<Switch
							aria-label={t("repeats")}
							checked={d.repeats}
							onCheckedChange={(v) => x.set({ repeats: v })}
						/>
					</div>
				</div>
			),
		},
	];
	const active = tabs.some((r) => r.id === tab) ? tab : "category";

	const parts: AnswerPart[] = [
		category
			? {
					id: "category",
					text: displayName(category.name),
					onSelect: () => setTab("category"),
				}
			: {
					id: "category",
					text: te("pickCategory"),
					tone: "attention",
					onSelect: () => setTab("category"),
				},
		{ id: "when", text: dayLabel(d.date), onSelect: () => setTab("when") },
		{
			id: "into",
			text: x.account
				? t("summary.into", { account: x.account.name })
				: t("summary.noAccount"),
			onSelect: () => setTab("into"),
		},
		...(planTab
			? [
					{
						id: "plan",
						text: x.usePlan ? t("summary.plan") : t("notPlanned"),
						onSelect: () => setTab("plan"),
					},
				]
			: []),
		...(d.note
			? [{ id: "note", text: t("note"), onSelect: () => setTab("more") }]
			: []),
		...(d.repeats
			? [{ id: "repeats", text: t("repeats"), onSelect: () => setTab("more") }]
			: []),
	];

	return (
		<ComposerFrame
			active={active}
			changes={changes}
			entry={
				<>
					<Field label={t("amount")}>
						<IncomeAmount home={catalog.homeCurrency} tried={tried} x={x} />
					</Field>
					<Field
						error={err("source") ? t("error.source") : null}
						label={t("from")}
					>
						<SourceField
							onChange={(source) => x.set({ source })}
							value={d.source}
						/>
					</Field>
					<AnswerLine parts={parts} />
				</>
			}
			label={t("tabs.label")}
			onActive={setTab}
			tabs={tabs}
		/>
	);
}
