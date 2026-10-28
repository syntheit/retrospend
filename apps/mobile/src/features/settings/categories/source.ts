import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

type Client = RetrospendClient["categories"];

export type Category = Awaited<ReturnType<Client["list"]>>["items"][number];
export type CategoryColor = Category["color"];

export const CATEGORIES_CACHE: CacheKey = {
	name: "settings.categories",
	schema: 1,
};

export function fetchCategories(api: RetrospendClient) {
	return async (): Promise<Category[]> =>
		(await api.categories.list({ limit: 200 })).items;
}

export interface CategoryDraft {
	name: string;
	color: CategoryColor;
	/** A key from CATEGORY_ICON_NAMES; null: the glyph the name suggests. */
	icon: string | null;
	excludeByDefault: boolean;
}

export function draftOf(category: Category | null): CategoryDraft {
	return {
		name: category?.name ?? "",
		color: category?.color ?? "teal",
		icon: category?.icon ?? null,
		excludeByDefault: category?.excludeByDefault ?? false,
	};
}

export function draftValid(draft: CategoryDraft): boolean {
	const name = draft.name.trim();
	return name.length > 0 && name.length <= 64;
}

/** A name the person already uses is a conflict on the server; say so before sending. */
export function nameTaken(
	draft: CategoryDraft,
	all: readonly Category[],
	editingId: string | null,
): boolean {
	const name = draft.name.trim().toLowerCase();
	return all.some((c) => c.id !== editingId && c.name.toLowerCase() === name);
}

/** What changed, as the PATCH wants it; empty when nothing did. */
export function changesOf(
	draft: CategoryDraft,
	category: Category,
): Partial<CategoryDraft> {
	const next: Partial<CategoryDraft> = {};
	if (draft.name.trim() !== category.name) next.name = draft.name.trim();
	if (draft.color !== category.color) next.color = draft.color;
	if (draft.icon !== category.icon) next.icon = draft.icon;
	if (draft.excludeByDefault !== category.excludeByDefault) {
		next.excludeByDefault = draft.excludeByDefault;
	}
	return next;
}
