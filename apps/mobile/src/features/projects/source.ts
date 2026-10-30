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

/** A project counts as just back for this many days after its last expense. */
export const JUST_BACK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The project the list leads with: an active shared project with an open
 * balance whose last expense is recent, the most recent first. The list has
 * no end date, so "recent" is the last expense, within JUST_BACK_DAYS of
 * `today` (a YYYY-MM-DD day).
 */
export function justBack(
	items: ProjectItem[],
	today: string,
): ProjectItem | null {
	const now = Date.parse(`${today}T12:00:00Z`);
	const recent = items
		.filter((p) => {
			if (p.status !== "ACTIVE" || p.solo || p.lastExpense === null) {
				return false;
			}
			if (!p.myBalance.some((line) => line.minor !== 0)) return false;
			const age = (now - Date.parse(`${p.lastExpense}T12:00:00Z`)) / DAY_MS;
			return age >= 0 && age <= JUST_BACK_DAYS;
		})
		.sort((a, b) => ((b.lastExpense ?? "") > (a.lastExpense ?? "") ? 1 : -1));
	return recent[0] ?? null;
}

/** How many whole days ago a day was, never below zero. */
export function daysSince(day: string, today: string): number {
	const diff =
		(Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) /
		DAY_MS;
	return Math.max(0, Math.round(diff));
}

/** Name search ignoring case and accents, like People's. */
export function matchesProject(item: ProjectItem, query: string): boolean {
	const fold = (text: string) =>
		text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	return query === "" || fold(item.name).includes(fold(query));
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
