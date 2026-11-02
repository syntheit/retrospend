import type { ActionDef } from "@/ui/actionRegistry";

/**
 * What can be done to a category, in one place: the row's long-press menu and
 * the category sheet (name, icon and color fields, the counts-in-spending
 * switch) read this list. Categories are not deleted from the phone, so
 * there is no destructive item.
 */
export type CategoryActionId = "rename" | "icon" | "count";

export const CATEGORY_ACTIONS: Record<
	CategoryActionId,
	ActionDef<CategoryActionId>
> = {
	rename: { id: "rename" },
	icon: { id: "icon" },
	count: { id: "count" },
};

export const categoryActionsOf = (): CategoryActionId[] => [
	"rename",
	"icon",
	"count",
];
