"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { DatePicker } from "~/components/pickers/date-picker";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { Field, type EntryCatalog } from "../shared-ui";
import type { EntryPerson } from "../types";
import { AmountField, type RateState } from "./amount-field";
import { CategoryLine } from "./category-line";
import { type DraftErrors, isShared } from "./draft";
import { OptionsSection } from "./options-section";
import { usePeople, WithField } from "./people-field";
import { ProjectField } from "./project-field";
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

/**
 * The one column (R23 parity): amount, title, category, date, project and
 * with, the split when shared, options, then what saving changes.
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
	const solo = !!members && members.length === 0;
	const people = usePeople(members);
	const editingShared = d.editing?.source === "shared";
	const canProject = d.editing === null || editingShared;
	const err = (k: keyof DraftErrors) =>
		p.tried && p.errors[k] ? true : undefined;
	return (
		<div className="flex flex-col gap-4">
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
			<Field
				error={err("category") ? t("error.category") : null}
				label={t("category")}
			>
				<CategoryLine
					categories={catalog.categories}
					onPick={x.pickCategory}
					recents={catalog.recentCategoryIds}
					ring={x.ring}
					value={d.categoryId}
				/>
			</Field>
			<Field label={t("date")}>
				<DatePicker
					onChange={(date) => x.set({ date })}
					today={p.today}
					value={d.date}
				/>
			</Field>
			<div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
				{canProject ? (
					<Field label={t("project")}>
						<ProjectField
							onChange={p.onProject}
							projects={p.projects}
							value={d.projectId}
						/>
					</Field>
				) : null}
				{(d.editing === null || editingShared) && !solo ? (
					<Field label={t("with")}>
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
							you={{ name: p.you.name, avatarUrl: p.you.avatarUrl ?? null }}
							youIncluded={d.youIncluded}
						/>
					</Field>
				) : null}
			</div>
			{solo && project ? (
				<p className="text-fg-3 text-small">
					{t("soloProject", { project: project.name })}
				</p>
			) : null}
			{shared && (d.others.length > 0 || !d.youIncluded) ? (
				<SplitSection
					showErrors={p.tried}
					shares={p.shares}
					splitError={!!p.errors.split}
					x={x}
					you={p.you}
				/>
			) : null}
			<OptionsSection
				d={d}
				onExclude={x.toggleExclude}
				onSet={x.set}
				personal={!shared}
			/>
			{p.duplicate ? <Notice tone="attention">{t("duplicate")}</Notice> : null}
			{p.changes}
		</div>
	);
}
