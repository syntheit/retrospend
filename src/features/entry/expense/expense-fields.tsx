"use client";

import { format } from "date-fns";
import { CalendarDays, FolderOpen, MoreHorizontal, Tag, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Money } from "~/components/money/money";
import { DatePicker } from "~/components/pickers/date-picker";
import { addDays, localDay } from "~/components/pickers/dates";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { DetailPager, type DetailTab } from "~/components/ui/detail-pager";
import { GlyphPill } from "~/components/ui/glyph-pill";
import { ProjectRow } from "~/components/ui/project-row";
import { SummaryLine, type SummaryPart } from "~/components/ui/summary-line";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { useCategoryName } from "~/hooks/use-category-name";
import { getDateFnsLocale } from "~/lib/date-locale";
import { Field, type EntryCatalog } from "../shared-ui";
import type { EntryPerson } from "../types";
import { AmountField, type RateState } from "./amount-field";
import { CategoryPanel } from "./category-panel";
import { type DraftErrors, isShared } from "./draft";
import { OptionsSection } from "./options-section";
import { usePeople, WithField } from "./people-field";
import { SplitSection } from "./split-section";
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

/** Days offered as pills: Today, Yesterday, then the ones before. */
const DAYS_BACK = 6;

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
	const df = useDateFormat();
	const td = useTranslations("pickers.date");
	const { displayName } = useCategoryName();
	const { x, catalog } = p;
	const { d } = x;
	const home = catalog.homeCurrency;
	const shared = isShared(d);
	const project = p.projects.find((pr) => pr.id === d.projectId) ?? null;
	// The list's members are only the first few: the full read wins once loaded.
	const members = project ? (p.projectMembers ?? project.members) : null;
	const solo = !!members && members.length === 0;
	const people = usePeople(members);
	const editingShared = d.editing?.source === "shared";
	const showPeople = d.editing === null || editingShared;
	const err = (k: keyof DraftErrors) =>
		p.tried && p.errors[k] ? true : undefined;
	const [tab, setTab] = useState<TabId>("category");
	// A save with no category goes to where it is picked.
	useEffect(() => {
		if (p.tried && p.errors.category) setTab("category");
	}, [p.tried, p.errors.category]);

	const category = catalog.categories.find((c) => c.id === d.categoryId);
	const sharedCount = (d.youIncluded ? 1 : 0) + d.others.length;
	const same = (a: { participantId: string; participantType: string }) =>
		a.participantId === d.paidBy.participantId &&
		a.participantType === d.paidBy.participantType;
	const payer = same(p.you)
		? t("you")
		: ([...d.others, ...(d.outsidePayer ? [d.outsidePayer] : [])].find(same)
				?.name ?? "");

	const dayLabel = (iso: string) =>
		iso === p.today
			? td("today")
			: iso === addDays(p.today, -1)
				? td("yesterday")
				: format(localDay(iso), "EEE d", {
						locale: getDateFnsLocale(df.locale),
					});
	const days = Array.from({ length: DAYS_BACK + 1 }, (_, i) =>
		addDays(p.today, -i),
	);
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
				<div className="flex flex-col gap-3">
					<div
						aria-label={t("date")}
						className="flex flex-wrap items-center gap-2"
						role="group"
					>
						{days.map((iso) => (
							<GlyphPill
								key={iso}
								onClick={() => x.set({ date: iso })}
								selected={d.date === iso}
							>
								{dayLabel(iso)}
							</GlyphPill>
						))}
						{!days.includes(d.date) ? (
							<GlyphPill selected>{df.label.long(d.date)}</GlyphPill>
						) : null}
					</div>
					<div>
						<DatePicker
							calendarOnly
							onChange={(date) => x.set({ date })}
							today={p.today}
							value={d.date}
						/>
					</div>
				</div>
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
							<div className="flex flex-col gap-4">
								{!solo ? (
									<WithField
										chips={people.chips}
										inProject={!!project}
										known={
											members
												? members.map((m) => ({
														...m,
														onRetrospend: m.participantType === "user",
													}))
												: people.known
										}
										onSet={x.setOthers}
										onToggle={x.togglePerson}
										onYou={x.toggleYou}
										others={d.others}
										you={{
											name: p.you.name,
											avatarUrl: p.you.avatarUrl ?? null,
										}}
										youIncluded={d.youIncluded}
									/>
								) : null}
								{solo && project ? (
									<p className="text-fg-3 text-small">
										{t("soloProject", { project: project.name })}
									</p>
								) : null}
								{shared && (d.others.length > 0 || !d.youIncluded) ? (
									<SplitSection
										shares={p.shares}
										showErrors={p.tried}
										splitError={!!p.errors.split}
										x={x}
										you={p.you}
									/>
								) : null}
							</div>
						),
					} satisfies DetailTab,
					{
						id: "project",
						label: t("tabs.project"),
						icon: <FolderOpen aria-hidden="true" />,
						tip: t("tabs.tip", { name: t("tabs.project"), key: 4 }),
						dot: !!d.projectId,
						panel: (
							<div
								aria-label={t("project")}
								className="flex flex-col gap-2"
								role="group"
							>
								<ProjectRow
									name={t("noProject")}
									onSelect={() => p.onProject(null)}
									selected={d.projectId === null}
								/>
								{p.projects.map((pr) => (
									<ProjectRow
										coverUrl={pr.coverUrl}
										key={pr.id}
										members={pr.members.map((m) => ({
											id: m.participantId,
											name: m.name,
											imageUrl: m.avatarUrl,
											isSelf: m.participantId === p.you.participantId,
										}))}
										meta={`${
											pr.peopleCount > 1
												? t("projectPeople", { count: pr.peopleCount })
												: t("projectSolo")
										} · ${pr.primaryCurrency}`}
										name={pr.name}
										onSelect={() => p.onProject(pr)}
										selected={d.projectId === pr.id}
									/>
								))}
							</div>
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

	const parts: SummaryPart[] = [
		category
			? {
					id: "category",
					text: displayName(category.name),
					onSelect: () => setTab("category"),
				}
			: {
					id: "category",
					text: t("pickCategory"),
					tone: "attention",
					onSelect: () => setTab("category"),
				},
		{ id: "when", text: dayLabel(d.date), onSelect: () => setTab("when") },
		...(showPeople
			? [
					{
						id: "who",
						text: shared
							? payer
								? t("summary.splitPaid", { count: sharedCount, name: payer })
								: t("summary.split", { count: sharedCount })
							: t("summary.solo"),
						onSelect: () => setTab("who"),
					},
				]
			: []),
		...(project
			? [
					{
						id: "project",
						text: project.name,
						onSelect: () => setTab("project"),
					},
				]
			: []),
		...(d.note
			? [{ id: "note", text: t("note"), onSelect: () => setTab("more") }]
			: []),
		...(d.spread !== "one"
			? [
					{
						id: "spread",
						text: t("spreadMonths", { count: Number(d.spread) }),
						onSelect: () => setTab("more"),
					},
				]
			: []),
	];

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
				<SummaryLine label={t("summary.label")} parts={parts} />
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
