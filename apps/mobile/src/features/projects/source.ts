import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import type { CacheKey } from "@/features/read/loadCached";

// Projects, Project and Settle all, all from API v1. Shapes are the
// contract's own, so a server change shows up here as a type error.

export type ProjectList = Awaited<
	ReturnType<RetrospendClient["projects"]["list"]>
>;
export type ProjectItem = ProjectList["items"][number];
export type ProjectPage = Awaited<
	ReturnType<RetrospendClient["projects"]["get"]>
>;
export type ProjectSummary = Awaited<
	ReturnType<RetrospendClient["projects"]["summary"]>
>;
export type ProjectMember = ProjectPage["members"][number];
export type ProjectExpense = ProjectPage["expenses"][number];

export const PROJECTS_CACHE: CacheKey = { name: "projects.list", schema: 1 };

export function projectCache(id: string): CacheKey {
	return { name: `project.${id}`, schema: 1 };
}

export function summaryCache(id: string, periodId: string | null): CacheKey {
	return { name: `project.${id}.summary.${periodId ?? "all"}`, schema: 1 };
}

export function fetchProjects(api: RetrospendClient) {
	return () => api.projects.list();
}

export function fetchProject(api: RetrospendClient, id: string) {
	return () => api.projects.get({ id });
}

export function fetchSummary(
	api: RetrospendClient,
	id: string,
	periodId: string | null,
) {
	return () => api.projects.summary(periodId ? { id, periodId } : { id });
}

export interface ProjectGroup {
	/** "active", or the year an archived project is listed under. */
	key: string;
	kind: "active" | "year";
	year: number | null;
	projects: ProjectItem[];
}

/**
 * Active projects first in the server's order (newest change first), then
 * archived ones under their year, newest year first. An empty group is left
 * out.
 */
export function groupProjects(items: ProjectItem[]): ProjectGroup[] {
	const active = items.filter((p) => p.status === "ACTIVE");
	const years = [
		...new Set(items.filter((p) => p.status === "ARCHIVED").map((p) => p.year)),
	].sort((a, b) => b - a);
	const groups: ProjectGroup[] = [];
	if (active.length > 0) {
		groups.push({
			key: "active",
			kind: "active",
			year: null,
			projects: active,
		});
	}
	for (const year of years) {
		groups.push({
			key: String(year),
			kind: "year",
			year,
			projects: items.filter((p) => p.status === "ARCHIVED" && p.year === year),
		});
	}
	return groups;
}

/** Name search ignoring case and accents, like People's. */
export function matchesProject(item: ProjectItem, query: string): boolean {
	const fold = (text: string) =>
		text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	return query === "" || fold(item.name).includes(fold(query));
}

/**
 * Stored category colors in the order of the 21 category-n tokens. The
 * server's own table is src/server/services/expense-list/category-tone.ts;
 * the project page sends the color name, not the number, so the phone maps
 * it (the other lists send `tone`).
 */
const CATEGORY_COLORS = [
	"emerald",
	"blue",
	"sky",
	"cyan",
	"teal",
	"orange",
	"amber",
	"violet",
	"pink",
	"fuchsia",
	"indigo",
	"slate",
	"zinc",
	"lime",
	"neutral",
	"gray",
	"purple",
	"yellow",
	"stone",
	"rose",
	"red",
];

/** The category-n design token a category color name stands for (1 to 21). */
export function toneOf(color: string | null | undefined): number | null {
	const at = color ? CATEGORY_COLORS.indexOf(color) : -1;
	return at < 0 ? null : at + 1;
}

export interface BalanceSides {
	/** What the group owes you, per currency (positive amounts). */
	owedToYou: Money[];
	/** What you owe the group, per currency (positive amounts). */
	youOwe: Money[];
}

/**
 * The balance lines split by side. Currencies are never netted against
 * each other: BRL owed to you and ARS you owe are two lines.
 */
export function balanceSides(lines: Money[]): BalanceSides {
	return {
		owedToYou: lines.filter((l) => l.minor > 0),
		youOwe: lines
			.filter((l) => l.minor < 0)
			.map((l) => ({ minor: -l.minor, currency: l.currency })),
	};
}
