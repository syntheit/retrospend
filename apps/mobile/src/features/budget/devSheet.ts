import type { OpenSheet } from "./BudgetSheets";
import { type BudgetMonth, envelopesOf } from "./source";

/**
 * Screenshot runs have no one to tap: a gallery build opens a sheet named by
 * the route (`/budget?sheet=afford`). The first envelope stands in for the
 * ones that need a row. Never reachable in a release build (the caller checks
 * the gallery flag).
 */
export function devSheet(name: string, data: BudgetMonth): OpenSheet | null {
	const first = envelopesOf(data)[0]?.id;
	switch (name) {
		case "afford":
		case "newEnvelope":
		case "merge":
		case "style":
		case "reconcile":
		case "payDebt":
		case "usePlan":
		case "takeBack":
			return { kind: name };
		case "target":
		case "edit":
		case "limit":
			return first ? { kind: "envelope", id: first, mode: name } : null;
		default:
			return null;
	}
}
