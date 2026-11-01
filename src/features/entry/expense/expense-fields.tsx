"use client";

import {
	CalendarDays,
	FolderOpen,
	MoreHorizontal,
	Tag,
	Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Money } from "~/components/money/money";
import { AnswerLine } from "~/components/ui/answer-line";
import { DetailPager, type DetailTab } from "~/components/ui/detail-pager";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { type EntryCatalog, Field } from "../shared-ui";
import type { EntryPerson } from "../types";
import { AmountField, type RateState } from "./amount-field";
import { CategoryPanel } from "./category-panel";
import { canEditPeople, type DraftErrors, isShared } from "./draft";
import { useAnswers } from "./expense-answers";
import { ProjectPanel, WhenPanel, WhoPanel } from "./expense-panels";
import { OptionsSection } from "./options-section";
import type { useExpenseDraft } from "./use-expense-draft";

export type Project = {
	id: string;
	name: string;
	/** The cover photo's URL, or null for the flat tile. */
	coverUrl: string | null;
	primaryCurrency: string;
	/** Everyone in it, you included (the server's count). */
	peopleCount: number;
	/** The project list's first few members: faces only, never the split. */
	members: EntryPerson[];
};

type TabId = "category" | "when" | "who" | "project" | "more";

/**
 * Two panes from md up (design D): entry on the left (amount, title, the
 * summary line of answers, what saving changes), the detail tabs on the
 * right with each panel in place. On a phone one column: the same entry
 * block, then the tabs and a swipe row of panels, then what saving changes.
 * The money layer (draft, rate, save, preview) is the caller's; this is the view.
 */
export function ExpenseFields(p: {
	x: ReturnType<typeof useExpenseDraft>;
	catalog: EntryCatalog;
	you: EntryPerson;
	today: string;
	rate: RateState;
	bookedHome: { minor: number; currency: string } | null;
	favorites?: readonly string[];
	projects: readonly Project[];
	/** The picked project's members on the expense's day, all of them (null while loading). */
	projectMembers: readonly EntryPerson[] | null;
	onProject: (project: Project | null) => void;
	shares: ReadonlyMap<string, number> | null;
	errors: DraftErrors;
	tried: boolean;
	verified: boolean;
	duplicate: boolean;
	changes: React.ReactNode;
}) {
	const t = useTranslations("entry.expense");
	const { x, catalog } = p;
	const { d } = x;
	const home = catalog.homeCurrency;
	const shared = isShared(d);
	const project = p.projects.find((pr) => pr.id === d.projectId) ?? null;
	// The list's members are only the first few: the full read wins once loaded.
	const members = project ? (p.projectMembers ?? project.members) : null;
	const showPeople = canEditPeople(d);
	const err = (k: keyof DraftErrors) =>
		p.tried && p.errors[k] ? true : undefined;
	const [tab, setTab] = useState<TabId>("category");
	// A save with no category goes to where it is picked.
	useEffect(() => {
		if (p.tried && p.errors.category) setTab("category");
	}, [p.tried, p.errors.category]);

	const { parts, days, dayLabel } = useAnswers({
		catalog,
		go: (id) => setTab(id),
		project,
		showPeople,
		today: p.today,
		x,
		you: p.you,
	});
	const moreOn = !!d.note || !!d.location || d.spread !== "one" || d.exclude;

	const tabs: DetailTab[] = [
		{
			id: "category",
			label: t("tabs.category"),
			icon: <Tag aria-hidden="true" />,
			tip: t("tabs.tip", { name: t("tabs.category"), key: 1 }),
			dot: !!d.categoryId,
			panel: (
				<div className="flex flex-col gap-2">
					<CategoryPanel
						categories={catalog.categories}
						onPick={x.pickCategory}
						recents={catalog.recentCategoryIds}
						ring={x.ring}
						value={d.categoryId}
					/>
					{err("category") ? (
						<span className="text-danger text-small" role="alert">
							{t("error.category")}
						</span>
					) : null}
				</div>
			),
		},
		{
			id: "when",
			label: t("tabs.when"),
			icon: <CalendarDays aria-hidden="true" />,
			tip: t("tabs.tip", { name: t("tabs.when"), key: 2 }),
			dot: d.date !== p.today,
			panel: (
				<WhenPanel dayLabel={dayLabel} days={days} today={p.today} x={x} />
			),
		},
		...(showPeople
			? [
					{
						id: "who",
						label: t("tabs.who"),
						icon: <Users aria-hidden="true" />,
						tip: t("tabs.tip", { name: t("tabs.who"), key: 3 }),
						dot: shared,
						panel: (
							<WhoPanel
								members={members}
								project={project}
								shares={p.shares}
								splitError={!!p.errors.split}
								tried={p.tried}
								x={x}
								you={p.you}
							/>
						),
					} satisfies DetailTab,
					{
						id: "project",
						label: t("tabs.project"),
						icon: <FolderOpen aria-hidden="true" />,
						tip: t("tabs.tip", { name: t("tabs.project"), key: 4 }),
						dot: !!d.projectId,
						panel: (
							<ProjectPanel
								onProject={p.onProject}
								projects={p.projects}
								value={d.projectId}
								you={p.you}
							/>
						),
					} satisfies DetailTab,
				]
			: []),
		{
			id: "more",
			label: t("tabs.more"),
			icon: <MoreHorizontal aria-hidden="true" />,
			tip: t("tabs.tip", { name: t("tabs.more"), key: showPeople ? 5 : 3 }),
			dot: moreOn,
			panel: (
				<OptionsSection
					d={d}
					onExclude={x.toggleExclude}
					onSet={x.set}
					personal={!shared}
				/>
			),
		},
	];
	const active = tabs.some((x) => x.id === tab) ? tab : "category";

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Alt+1 to 5 picks a tab from anywhere in the form
		<div
			className="grid gap-4 md:h-full md:grid-cols-5 md:gap-x-6 md:gap-y-4"
			onKeyDown={(e) => {
				if (!e.altKey || e.ctrlKey || e.metaKey) return;
				const n = /^Digit([1-5])$/.exec(e.code)?.[1];
				const hit = n ? tabs[Number(n) - 1] : undefined;
				if (!hit) return;
				e.preventDefault();
				setTab(hit.id as TabId);
			}}
		>
			<div className="flex min-w-0 flex-col gap-4 md:col-span-2 md:row-start-1">
				{p.verified ? <Notice>{t("verified")}</Notice> : null}
				<Field label={t("amount")}>
					<AmountField
						bookedHome={p.bookedHome}
						d={d}
						errors={{ amount: err("amount"), rate: err("rate") }}
						favorites={p.favorites}
						home={home}
						onAmount={x.setAmount}
						onCurrency={x.setCurrency}
						onCustom={x.pickCustom}
						onCustomText={x.setCustomText}
						onRate={x.pickRate}
						rate={p.rate}
						shared={shared}
						showErrors={p.tried}
					/>
				</Field>
				<Field htmlFor="entry-title" label={t("titleField")}>
					<Input
						autoComplete="off"
						id="entry-title"
						onChange={(e) => x.set({ title: e.target.value })}
						placeholder={t("titlePlaceholder")}
						value={d.title}
					/>
					{x.hint && !d.minor ? (
						<span className="text-fg-3 text-meta">
							{t.rich("lastTime", { amount: () => <Money value={x.hint!} /> })}
						</span>
					) : null}
				</Field>
				<AnswerLine parts={parts} />
				{p.duplicate ? (
					<Notice tone="attention">{t("duplicate")}</Notice>
				) : null}
			</div>
			<DetailPager
				active={active}
				className="md:bg-raised md:rounded-panel md:col-span-3 md:col-start-3 md:row-span-2 md:row-start-1 md:p-3"
				label={t("tabs.label")}
				onActive={(id) => setTab(id as TabId)}
				tabs={tabs}
			/>
			<div className="flex min-w-0 flex-col gap-4 md:col-span-2 md:row-start-2 md:self-end">
				{p.changes}
			</div>
		</div>
	);
}
