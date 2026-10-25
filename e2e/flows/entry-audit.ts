/**
 * Shared steps of the Add family flows (4G): a tRPC query as the app sends
 * it, and the figure audit scoped to the open sheet, whose figures (the home
 * amount, the preview lines) come from the entry router's own reads.
 */
import { expect, type Page } from "@playwright/test";
import { FigureAudit, type FiguresResponse } from "../helpers/figures";
import { requiredFiguresFor } from "../helpers/required-figures";

type Money = { minor: number; currency: string };

export async function trpcQuery<T>(
	page: Page,
	path: string,
	input?: unknown,
): Promise<T> {
	const q =
		input === undefined
			? ""
			: `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
	const res = await page.request.get(`/api/trpc/${path}${q}`);
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

/** A tRPC mutation as the app sends it. */
export async function trpcMutation<T>(
	page: Page,
	path: string,
	input: unknown,
): Promise<T> {
	const origin = new URL(page.url()).origin;
	const res = await page.request.post(`/api/trpc/${path}`, {
		data: { json: input },
		headers: { Origin: origin },
	});
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

/** Figures served from a map the flow built from the same server reads. */
export function mapFetcher(values: Record<string, Money>) {
	return async (ids: string[]): Promise<FiguresResponse> => ({
		figures: ids.flatMap((id) => {
			const m = values[id];
			return m
				? [{ id, unit: "money" as const, minor: m.minor, currency: m.currency }]
				: [];
		}),
		missing: ids.filter((id) => !values[id]),
	});
}

/** The preview's figure lines as the sheet tags them. */
export function previewFigures(preview: {
	changes: { id: string; delta: Money; after: Money | null }[];
}): Record<string, Money> {
	const out: Record<string, Money> = {};
	for (const c of preview.changes) {
		out[`preview.${c.id}.delta`] = c.delta;
		if (c.after) out[`preview.${c.id}.after`] = c.after;
	}
	return out;
}

/** Audits the figures inside the open sheet against `values`. */
export async function auditSheet(
	page: Page,
	label: string,
	values: Record<string, Money>,
): Promise<string[]> {
	const rendered = await page.evaluate(() => {
		const root = document.querySelector('[role="dialog"]');
		return {
			locale: document.documentElement.lang || "en-US",
			v2: true,
			tags: [
				...(root?.querySelectorAll<HTMLElement>("[data-figure]") ?? []),
			].map((el) => ({
				id: el.dataset.figure ?? null,
				minor: el.dataset.minor ?? null,
				currency: el.dataset.currency ?? null,
				unit: el.dataset.unit ?? null,
				text: el.textContent ?? "",
			})),
		};
	});
	return new FigureAudit(mapFetcher(values)).checkRendered(
		label,
		rendered,
		requiredFiguresFor(label),
	);
}
