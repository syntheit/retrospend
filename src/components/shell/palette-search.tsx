"use client";

import type { SearchHit, SearchResult } from "@retrospend/api-contract";
import { useQuery } from "@tanstack/react-query";
import { List, Receipt, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useEntryActions } from "~/features/entry/entry-actions";
import { Money } from "~/components/money/money";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { ProjectVisual } from "~/components/project/project-visual";
import { Face } from "~/components/ui/avatar-face";
import { CommandGroup } from "~/components/ui/command";
import { categoryTone } from "~/lib/category-tone";
import { projectHref } from "~/lib/nav";
import { PALETTE_GROUP, PaletteItem } from "./palette";

/** Hits per group: the palette is a jump list, not a results page. */
const PER_GROUP = 4;
const DEBOUNCE_MS = 200;

/** The typed text, once the person stops typing for a moment. */
function useSettledText(text: string): string {
	const [settled, setSettled] = useState(text);
	useEffect(() => {
		const id = setTimeout(() => setSettled(text), DEBOUNCE_MS);
		return () => clearTimeout(id);
	}, [text]);
	return settled;
}

/** One search read (API v1 GET /search): accent and case insensitive, RLS scoped. */
async function fetchSearch(q: string): Promise<SearchResult> {
	const params = new URLSearchParams({ q, limit: String(PER_GROUP) });
	const res = await fetch(`/api/v1/search?${params}`, {
		credentials: "same-origin",
	});
	if (!res.ok) throw new Error(`search ${res.status}`);
	return (await res.json()) as SearchResult;
}

function HitItem({
	hit,
	query,
	go,
	run,
}: {
	hit: SearchHit;
	query: string;
	go: (href: string) => void;
	run: (fn: () => void) => () => void;
}) {
	const t = useTranslations("shell.palette");
	const { openExpense } = useEntryActions();
	// The server matched it (accents included), so the palette's own filter
	// must keep it: the value carries the query.
	const value = `search ${hit.type} ${hit.id} ${query}`;
	switch (hit.type) {
		case "expense":
			return (
				<PaletteItem
					label={hit.title}
					lead={<Receipt aria-hidden="true" />}
					onSelect={run(() => openExpense(hit.id))}
					small={<Money value={hit.amount} />}
					value={value}
				/>
			);
		case "person":
			return (
				<PaletteItem
					label={hit.name}
					lead={<Face name={hit.name} size="xs" />}
					onSelect={() => go(`/people/${hit.participantType}/${hit.id}`)}
					small={hit.username ? `@${hit.username}` : undefined}
					value={value}
				/>
			);
		case "project":
			return (
				<PaletteItem
					label={hit.name}
					lead={
						<ProjectVisual
							className="rounded-ctl size-5"
							imagePath={null}
							projectName={hit.name}
							size="xs"
						/>
					}
					onSelect={() => go(projectHref(hit.id))}
					small={hit.status === "ARCHIVED" ? t("archived") : undefined}
					value={value}
				/>
			);
		case "category":
			// The hit has no icon name (GAPS: search category icon): the glyph follows the name.
			return (
				<PaletteItem
					label={hit.name}
					lead={
						<CategoryGlyph
							category={{
								id: hit.id,
								name: hit.name,
								tone: categoryTone(hit.color),
							}}
						/>
					}
					onSelect={() => go(`/activity?cat=${encodeURIComponent(hit.id)}`)}
					value={value}
				/>
			);
	}
}

/**
 * The palette's typed results (RC14): expenses, people, projects and
 * categories from the one search read, each group under its own heading.
 * Nothing shows until the person types; a failed read shows nothing (the
 * Go to and Commands groups still answer).
 */
export function SearchGroups({
	search,
	open,
	go,
	run,
}: {
	search: string;
	open: boolean;
	go: (href: string) => void;
	run: (fn: () => void) => () => void;
}) {
	const t = useTranslations("shell.palette.groups");
	const q = useSettledText(search.trim());
	const { data } = useQuery({
		queryKey: ["palette-search", q],
		queryFn: () => fetchSearch(q),
		enabled: open && q.length > 0,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});
	if (!q || !data) return null;
	const activity = `/activity?q=${encodeURIComponent(q)}`;
	const groups = ORDER.flatMap((type) =>
		data.groups.filter((g) => g.type === type && g.items.length > 0),
	);
	// Nothing found: the search can still run over Activity (mockup).
	if (!groups.length)
		return (
			<CommandGroup className={PALETTE_GROUP} heading={t("none")}>
				<PaletteItem
					label={t("searchActivity", { q })}
					lead={<Search aria-hidden="true" />}
					onSelect={() => go(activity)}
					value={`search activity ${search}`}
				/>
			</CommandGroup>
		);
	return groups.map((g) => (
		<CommandGroup className={PALETTE_GROUP} heading={t(g.type)} key={g.type}>
			{g.items.map((hit) => (
				<HitItem
					go={go}
					hit={hit}
					key={`${hit.type}-${hit.id}`}
					query={search}
					run={run}
				/>
			))}
			{g.type === "expenses" && g.nextCursor ? (
				<PaletteItem
					label={t("allExpenses")}
					lead={<List aria-hidden="true" />}
					onSelect={() => go(activity)}
					small={t("activity")}
					value={`search all expenses ${search}`}
				/>
			) : null}
		</CommandGroup>
	));
}

/** Typed results after Go to and Commands, people first (kit paletteItems). */
const ORDER = ["people", "projects", "categories", "expenses"] as const;
