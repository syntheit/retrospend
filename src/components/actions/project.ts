import {
	Archive,
	ArchiveRestore,
	Banknote,
	Download,
	FileText,
	Link,
	Pin,
	Plus,
	Settings,
	Trash2,
	UserPlus,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

export type ProjectTarget = ActionTarget & {
	/** A solo project has nobody to settle with. */
	solo: boolean;
	/** Archived projects offer Restore instead of Archive. */
	archived?: boolean;
	/** Only an owner archives, restores or deletes a project. */
	owner?: boolean;
};

const ownerOf = (p: ProjectTarget) => p.owner !== false;

export const PROJECT_ACTIONS: readonly ActionDef<ProjectTarget>[] = [
	{ id: "addExpense", icon: Plus, group: 0, swipe: "lead" },
	{ id: "pin", icon: Pin, group: 0 },
	{ id: "share", icon: Link, group: 0 },
	{ id: "settleAll", icon: Banknote, group: 0, when: (p) => !p.solo },
	{ id: "addPerson", icon: UserPlus, group: 0 },
	{ id: "exportCsv", icon: Download, group: 1 },
	{ id: "exportPlan", icon: Download, group: 1, when: (p) => !p.solo },
	{ id: "exportPdf", icon: FileText, group: 1 },
	{ id: "settings", icon: Settings, group: 1 },
	{
		id: "archive",
		icon: Archive,
		group: 2,
		swipe: (p) => (p.archived || !ownerOf(p) ? null : "trail"),
		when: (p) => !p.archived && ownerOf(p),
	},
	{
		id: "restore",
		icon: ArchiveRestore,
		group: 2,
		when: (p) => p.archived === true && ownerOf(p),
	},
	{
		id: "delete",
		icon: Trash2,
		group: 2,
		danger: true,
		when: ownerOf,
	},
];
