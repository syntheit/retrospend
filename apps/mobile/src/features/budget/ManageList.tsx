import { useTranslations } from "use-intl";
import type { MenuItem } from "@/ui/types";
import type { OpenSheet } from "./BudgetSheets";
import { MORE_ROWS, type MoreKind } from "./MoreSheets";
import type { MonthKind } from "./months";

type RowKey =
	| MoreKind
	| "afford"
	| "newEnvelope"
	| "merge"
	| "payDebt"
	| "reconcile"
	| "style";

/** The sheets the page's menu opens, by month kind (closed months are read-only). */
export function manageRows(
	kind: MonthKind,
	isDebtBook: boolean,
): { key: RowKey; sheet: OpenSheet }[] {
	const rows: { key: RowKey; sheet: OpenSheet }[] =
		kind === "closed" ? [] : [{ key: "afford", sheet: { kind: "afford" } }];
	for (const row of MORE_ROWS) {
		if (row.months.includes(kind)) {
			rows.push({ key: row.kind, sheet: { kind: row.kind } });
		}
	}
	if (kind === "open") {
		rows.push(
			{ key: "newEnvelope", sheet: { kind: "newEnvelope" } },
			{ key: "merge", sheet: { kind: "merge" } },
		);
		if (isDebtBook) rows.push({ key: "payDebt", sheet: { kind: "payDebt" } });
		rows.push(
			{ key: "reconcile", sheet: { kind: "reconcile" } },
			{ key: "style", sheet: { kind: "style" } },
		);
	}
	return rows;
}

/**
 * The page's overflow items for the top bar's menu: what-if, income, debt,
 * style and the rest, one item each. Can I afford something is the link under
 * the hero and Add an envelope is the button under the list, so neither
 * repeats here. Empty while there is no month to act on.
 */
export function useManageItems(
	page: { kind: MonthKind; isDebtBook: boolean } | null,
	onOpen: (sheet: OpenSheet) => void,
): MenuItem[] {
	const t = useTranslations("mobile.budget.manage");
	if (!page) return [];
	return manageRows(page.kind, page.isDebtBook)
		.filter((row) => row.key !== "afford" && row.key !== "newEnvelope")
		.map((row) => ({
			id: row.key,
			label: t(row.key),
			onPress: () => onOpen(row.sheet),
		}));
}
