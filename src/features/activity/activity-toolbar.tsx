"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Toolbar } from "~/components/layout/toolbar";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { DateRange } from "~/components/pickers/date-range";
import { Face } from "~/components/ui/avatar-face";
import {
	FilterChips,
	FilterMenu,
	type FilterMenuGroup,
} from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { categoryTone } from "~/server/services/expense-list/category-tone";
import type { ActivityKind } from "~/server/services/expense-list/types";
import { api } from "~/trpc/react";
import { DimChip, type DimItem } from "./dim-chip";
import { type ActivityFilter, type Dim, toggled } from "./filters";

/** The Type filter's choices, in the mockup's order. */
const KINDS: ActivityKind[] = [
	"expense",
	"in",
	"refund",
	"transfer",
	"payment",
];

function useDimItems() {
	const t = useTranslations("activity.filters");
	const categories = api.categories.getAll.useQuery(undefined, {
		staleTime: 60_000,
	});
	const people = api.people.list.useQuery(undefined, { staleTime: 60_000 });
	const projects = api.project.list.useQuery({}, { staleTime: 60_000 });
	return useMemo(() => {
		const persons: DimItem[] = (people.data ?? []).map(({ identity: p }) => ({
			id: `${p.participantType}:${p.participantId}`,
			label: p.name,
			lead: <Face imageUrl={p.avatarUrl} name={p.name} size="xs" />,
		}));
		return {
			cats: (categories.data ?? []).map((c): DimItem => {
				const ref = {
					id: c.id,
					name: c.name,
					icon: c.icon,
					tone: categoryTone(c.color),
				};
				return {
					id: c.id,
					label: c.name,
					lead: <CategoryGlyph category={ref} />,
				};
			}),
			people: persons,
			projects: (projects.data ?? []).map(
				(p): DimItem => ({ id: p.id, label: p.name }),
			),
			paidBy: [{ id: "me", label: t("you") }, ...persons],
			kinds: KINDS.map((k): DimItem => ({ id: k, label: t(`kind.${k}`) })),
		} satisfies Record<Dim, DimItem[]>;
	}, [categories.data, people.data, projects.data, t]);
}

/**
 * Search, the date range, the dimension chips and the Filter menu (R1, R7):
 * one row. Paid by and Type get a chip only once set; the Filter menu adds
 * them. Every chip writes the one filter the list, count and footer read.
 */
export function ActivityToolbar({
	filter,
	setFilter,
	search,
	setSearch,
	today,
	compare,
	setCompare,
}: {
	compare: boolean;
	setCompare: (on: boolean) => void;
	filter: ActivityFilter;
	setFilter: (f: ActivityFilter) => void;
	search: string;
	setSearch: (q: string) => void;
	today: string;
}) {
	const t = useTranslations("activity.filters");
	const items = useDimItems();
	const set = (dim: Dim) => (value: string[]) =>
		setFilter({ ...filter, [dim]: value });
	const chip = (dim: Dim) => (
		<DimChip
			items={items[dim]}
			label={t(`dim.${dim}`)}
			onChange={set(dim)}
			value={filter[dim]}
		/>
	);
	const menu: FilterMenuGroup[] = [
		{
			id: "kinds",
			label: t("dim.kinds"),
			items: items.kinds.map((i) => ({
				...i,
				checked: filter.kinds.includes(i.id as ActivityKind),
			})),
		},
		{
			id: "paidBy",
			label: t("dim.paidBy"),
			items: items.paidBy
				.slice(0, 6)
				.map((i) => ({ ...i, checked: filter.paidBy.includes(i.id) })),
		},
	];
	return (
		<Toolbar
			label={t("label")}
			search={
				<div className="relative max-md:w-full">
					<Search
						aria-hidden="true"
						className="text-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
					/>
					<Input
						aria-label={t("search")}
						className="h-ctl w-60 pl-9 max-md:w-full"
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("search")}
						type="search"
						value={search}
					/>
				</div>
			}
		>
			<FilterChips>
				<DateRange
					compare={compare}
					onChange={(r) => {
						setCompare(r.compare);
						setFilter({ ...filter, range: { from: r.from, to: r.to } });
					}}
					today={today}
					value={filter.range}
				/>
				{chip("cats")}
				{chip("people")}
				{chip("projects")}
				{filter.paidBy.length > 0 && chip("paidBy")}
				{filter.kinds.length > 0 && chip("kinds")}
				<FilterMenu
					groups={menu}
					onToggle={(group, id) => {
						const dim = group as "kinds" | "paidBy";
						setFilter({ ...filter, [dim]: toggled<string>(filter[dim], id) });
					}}
				/>
			</FilterChips>
		</Toolbar>
	);
}
