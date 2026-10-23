import {
	Archive,
	ArchiveRestore,
	ArrowDownLeft,
	History,
	Pencil,
	PencilLine,
	Trash2,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A closed account keeps its history and can be reopened. */
export type AccountTarget = ActionTarget & { closed?: boolean };

const open = (a: AccountTarget) => !a.closed;
const closed = (a: AccountTarget) => !!a.closed;

export const ACCOUNT_ACTIONS: readonly ActionDef<AccountTarget>[] = [
	{
		id: "updateBalance",
		icon: PencilLine,
		group: 0,
		when: open,
		swipe: (a) => (a.closed ? null : "lead"),
	},
	{ id: "addIncome", icon: ArrowDownLeft, group: 0, when: open },
	{ id: "history", icon: History, group: 0 },
	{ id: "edit", icon: Pencil, group: 0, when: open },
	{
		id: "reopen",
		icon: ArchiveRestore,
		group: 0,
		when: closed,
		swipe: (a) => (a.closed ? "lead" : null),
	},
	{
		id: "close",
		icon: Archive,
		group: 1,
		when: open,
		swipe: (a) => (a.closed ? null : "trail"),
	},
	{
		id: "delete",
		icon: Trash2,
		group: 1,
		danger: true,
		swipe: (a) => (a.closed ? "trail" : null),
	},
];
