import { ListChecks } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** An import waiting for review (Needs you `import.review`). */
export type ImportTarget = ActionTarget;

export const IMPORT_ACTIONS: readonly ActionDef<ImportTarget>[] = [
	{ id: "review", icon: ListChecks, group: 0 },
];
