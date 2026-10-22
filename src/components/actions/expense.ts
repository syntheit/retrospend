import {
	Check,
	Copy,
	Eye,
	FolderInput,
	MessageCircle,
	Pencil,
	Split,
	Tag,
	Trash2,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** What the expense actions need to know about a row. */
export type ExpenseTarget = ActionTarget & {
	/** You created it: only the creator edits, splits, recategorizes or deletes. */
	mine: boolean;
	/** A payment settled it, so a change becomes Correct (records the difference). */
	locked: boolean;
	reviewed: boolean;
	/** Already split with someone. */
	shared: boolean;
};

const own = (e: ExpenseTarget) => e.mine;
const editable = (e: ExpenseTarget) => e.mine && !e.locked;

export const EXPENSE_ACTIONS: readonly ActionDef<ExpenseTarget>[] = [
	{
		id: "review",
		icon: Check,
		group: 0,
		when: (e) => !e.reviewed,
		swipe: (e) => (e.reviewed ? null : "lead"),
	},
	{ id: "open", icon: Eye, group: 0 },
	{ id: "edit", icon: Pencil, kbd: "E", group: 0, when: editable },
	{ id: "askFix", icon: MessageCircle, group: 0, when: (e) => !e.mine },
	{ id: "correct", icon: Pencil, group: 0, when: (e) => e.mine && e.locked },
	{
		id: "split",
		icon: Split,
		group: 0,
		when: (e) => e.mine && !e.shared,
		swipe: (e) => (e.reviewed ? "lead" : null),
	},
	{ id: "category", icon: Tag, group: 0, when: own },
	{ id: "project", icon: FolderInput, group: 0, when: own },
	{ id: "duplicate", icon: Copy, group: 0 },
	{
		id: "delete",
		icon: Trash2,
		group: 1,
		danger: true,
		swipe: "trail",
		when: editable,
	},
];
