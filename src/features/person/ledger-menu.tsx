"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { FilterMenu } from "~/components/ui/chip";
import type { LedgerFilters, LedgerItem } from "./ledger-filter";

/**
 * The Filter menu of Between you (person.html): the categories and projects
 * the rows have, each with its identity (a bare glyph; projects have no
 * cover yet). Picking one again clears it; one of each at a time.
 */
export function LedgerMenu({
	items,
	filters,
	onFilters,
}: {
	items: readonly LedgerItem[];
	filters: LedgerFilters;
	onFilters: (f: LedgerFilters) => void;
}) {
	const t = useTranslations("personPage.ledger");
	const { categories, projects } = useMemo(() => {
		const cats = new Map<
			string,
			{ name: string; icon: string | null; tone: number }
		>();
		const projs = new Map<string, string>();
		for (const i of items) {
			if (i.kind !== "expense") continue;
			if (i.row.category) cats.set(i.row.category.name, i.row.category);
			if (i.row.project) projs.set(i.row.project.id, i.row.project.name);
		}
		return { categories: [...cats.values()], projects: [...projs] };
	}, [items]);
	if (!categories.length && !projects.length) return null;
	return (
		<FilterMenu
			groups={[
				{
					id: "category",
					label: t("categoryGroup"),
					items: categories.map((c) => ({
						id: c.name,
						label: c.name,
						lead: <CategoryGlyph category={{ id: c.name, ...c }} />,
						checked: filters.category === c.name,
					})),
				},
				{
					id: "project",
					label: t("projectGroup"),
					items: projects.map(([id, name]) => ({
						id,
						label: name,
						checked: filters.scope === id,
					})),
				},
			].filter((g) => g.items.length > 0)}
			onToggle={(group, id, on) =>
				onFilters(
					group === "category"
						? { ...filters, category: on ? id : null }
						: { ...filters, scope: on ? id : null },
				)
			}
		/>
	);
}
