"use client";

import { useTranslations } from "next-intl";
import { DatePicker } from "~/components/pickers/date-picker";
import { FilterChips } from "~/components/ui/chip";
import { GlyphPill } from "~/components/ui/glyph-pill";
import { ProjectChoice } from "~/components/ui/project-choice";
import type { EntryPerson } from "../types";
import { isShared } from "./draft";
import type { Project } from "./expense-fields";
import { usePeople, WithField } from "./people-field";
import { SplitSection } from "./split-section";
import type { useExpenseDraft } from "./use-expense-draft";

type Draft = ReturnType<typeof useExpenseDraft>;

/** When: the last days as pills, then the calendar. */
export function WhenPanel(p: {
	x: Draft;
	today: string;
	days: readonly string[];
	dayLabel: (iso: string) => string;
}) {
	const t = useTranslations("entry.expense");
	const { x } = p;
	return (
		<div className="flex flex-col gap-3">
			<FilterChips
				className="max-md:flex-wrap max-md:overflow-x-visible"
				label={t("date")}
			>
				{p.days.map((iso) => (
					<GlyphPill
						key={iso}
						onClick={() => x.set({ date: iso })}
						selected={x.d.date === iso}
					>
						{p.dayLabel(iso)}
					</GlyphPill>
				))}
			</FilterChips>
			<div>
				<DatePicker
					calendarOnly
					onChange={(date) => x.set({ date })}
					today={p.today}
					value={x.d.date}
				/>
			</div>
		</div>
	);
}

/** Who: the people chips, then Paid by, Split and the per-person rows when shared. */
export function WhoPanel(p: {
	x: Draft;
	you: EntryPerson;
	project: Project | null;
	members: readonly EntryPerson[] | null;
	shares: ReadonlyMap<string, number> | null;
	tried: boolean;
	splitError: boolean;
}) {
	const t = useTranslations("entry.expense");
	const { x, members, project } = p;
	const { d } = x;
	const people = usePeople(members);
	const solo = !!members && members.length === 0;
	return (
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
					you={{ name: p.you.name, avatarUrl: p.you.avatarUrl ?? null }}
					youIncluded={d.youIncluded}
				/>
			) : null}
			{solo && project ? (
				<p className="text-fg-3 text-small">
					{t("soloProject", { project: project.name })}
				</p>
			) : null}
			{isShared(d) && (d.others.length > 0 || !d.youIncluded) ? (
				<SplitSection
					shares={p.shares}
					showErrors={p.tried}
					splitError={p.splitError}
					x={x}
					you={p.you}
				/>
			) : null}
		</div>
	);
}

/** Project: None and each project as a row with its people and currency. */
export function ProjectPanel(p: {
	projects: readonly Project[];
	value: string | null;
	you: EntryPerson;
	onProject: (project: Project | null) => void;
}) {
	const t = useTranslations("entry.expense");
	return (
		<ul aria-label={t("project")} className="flex flex-col gap-2">
			<ProjectChoice
				name={t("noProject")}
				onSelect={() => p.onProject(null)}
				selected={p.value === null}
			/>
			{p.projects.map((pr) => (
				<ProjectChoice
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
					selected={p.value === pr.id}
				/>
			))}
		</ul>
	);
}
