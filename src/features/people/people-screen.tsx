"use client";

import { SearchX, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntryActions } from "~/features/entry/entry-actions";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Toolbar } from "~/components/layout/toolbar";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Tip } from "~/components/ui/tooltip";
import { SettleSheet } from "~/features/settle/settle-sheet";
import { useIsMobile } from "~/hooks/use-mobile";
import { AddPersonSheet } from "./add-person-sheet";
import { groupPeople, matchesPerson } from "./filter";
import { NeedsBlock } from "./needs-block";
import { PeopleGroup, PeopleRows, SettledWall } from "./people-rows";
import { PeopleEmpty } from "./people-states";
import { SortMenu } from "./sort-menu";
import { Standing } from "./standing";
import {
	NO_PEOPLE_FILTERS,
	type PeopleFilters,
	type PeopleOverview,
	type PeopleSort,
	type PersonIdentityDTO,
	type PersonSummary,
} from "./types";
import { usePersonActions } from "./use-person-actions";

/** "/" focuses the search, unless you are typing somewhere else. */
function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const typing =
				el?.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName ?? "");
			if (e.key !== "/" || typing || e.metaKey || e.ctrlKey) return;
			e.preventDefault();
			ref.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [ref]);
}

/** The People page: header, standing, Needs you, toolbar, the groups. */
export function PeopleScreen({
	view,
	today,
}: {
	view: PeopleOverview;
	today: string;
}) {
	const t = useTranslations("peoplePage");
	const locale = useLocale();
	const phone = useIsMobile();
	const { openNewExpense } = useEntryActions();
	const search = useRef<HTMLInputElement>(null);
	useSlashFocus(search);
	const [filters, setFilters] = useState<PeopleFilters>(NO_PEOPLE_FILTERS);
	const [sort, setSort] = useState<PeopleSort>("balance");
	const [adding, setAdding] = useState(false);
	const [settle, setSettle] = useState<PersonIdentityDTO | null>(null);
	const actionsFor = usePersonActions(setSettle);
	const handlersFor = useCallback(
		(p: PersonSummary) =>
			actionsFor(p.person, {
				open: p.parts.length > 0,
				owesYou: p.group === "owed",
			}),
		[actionsFor],
	);
	const all = useMemo(
		() => groupPeople(view.people, sort, locale),
		[view.people, sort, locale],
	);
	const shown = useMemo(
		() =>
			groupPeople(
				view.people.filter((p) => matchesPerson(p, filters)),
				sort,
				locale,
			),
		[view.people, filters, sort, locale],
	);
	const set = (patch: Partial<PeopleFilters>) =>
		setFilters((f) => ({ ...f, ...patch }));
	const filtered = filters !== NO_PEOPLE_FILTERS;
	const count = Object.values(shown).reduce((n, g) => n + g.length, 0);
	// Phones keep the sort in the chips row (one row of controls, R7).
	const sortMenu = <SortMenu onChange={setSort} value={sort} />;
	const add = phone ? (
		<Tip content={t("addPerson.title")}>
			<Button
				aria-label={t("addPerson.title")}
				icon
				kind="ghost"
				onClick={() => setAdding(true)}
			>
				<UserPlus />
			</Button>
		</Tip>
	) : (
		<Button kind="primary" onClick={() => setAdding(true)}>
			<UserPlus />
			{t("addPerson.title")}
		</Button>
	);

	return (
		<PageFrame label="people">
			<PageHeader primary={add} title={t("title")} />
			{view.people.length === 0 ? (
				<PeopleEmpty
					onAddExpense={() => openNewExpense()}
					onAddPerson={() => setAdding(true)}
				/>
			) : (
				<>
					<Standing
						owe={all.owe}
						owed={all.owed}
						settled={all.settled}
						view={view}
					/>
					<NeedsBlock needs={view.needs} />
					<Toolbar
						end={phone ? undefined : sortMenu}
						label={t("toolbar.label")}
						search={
							<Input
								aria-label={t("toolbar.search")}
								className="h-ctl w-60 max-md:w-full"
								onChange={(e) => set({ query: e.target.value })}
								placeholder={t("toolbar.search")}
								ref={search}
								type="search"
								value={filters.query}
							/>
						}
					>
						<FilterChips label={t("toolbar.label")}>
							<FilterChip
								onClick={() =>
									set({ dir: filters.dir === "owed" ? null : "owed" })
								}
								selected={filters.dir === "owed"}
							>
								{t("toolbar.owesYou")}
							</FilterChip>
							<FilterChip
								onClick={() =>
									set({ dir: filters.dir === "owe" ? null : "owe" })
								}
								selected={filters.dir === "owe"}
							>
								{t("toolbar.youOwe")}
							</FilterChip>
							<FilterChip
								onClick={() =>
									set({ notOnRetrospend: !filters.notOnRetrospend })
								}
								selected={filters.notOnRetrospend}
							>
								{t("toolbar.notOnRetrospend")}
							</FilterChip>
							{phone && sortMenu}
						</FilterChips>
					</Toolbar>
					{count === 0 && filtered ? (
						<Empty
							action={
								<Button
									kind="secondary"
									onClick={() => setFilters(NO_PEOPLE_FILTERS)}
									size="sm"
								>
									{t("toolbar.clear")}
								</Button>
							}
							hint={t("noMatch.hint")}
							icon={SearchX}
							title={t("noMatch.title")}
						/>
					) : (
						<>
							{(["owed", "owe", "pending"] as const).map((g) => (
								<PeopleGroup
									count={shown[g].length}
									id={g}
									key={g}
									title={t(`groups.${g}`)}
								>
									<PeopleRows
										handlersFor={handlersFor}
										label={t(`groups.${g}`)}
										people={shown[g]}
										today={today}
										words={g === "pending"}
									/>
								</PeopleGroup>
							))}
							{shown.settled.length > 0 && (
								<SettledWall
									handlersFor={handlersFor}
									people={shown.settled}
									today={today}
								/>
							)}
						</>
					)}
				</>
			)}
			<AddPersonSheet onOpenChange={setAdding} open={adding} />
			<SettleSheet onClose={() => setSettle(null)} person={settle} />
		</PageFrame>
	);
}
