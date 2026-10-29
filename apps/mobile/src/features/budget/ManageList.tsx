import { useTranslations } from "use-intl";
import { Menu } from "@/ui/Menu";
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
 * The page's overflow: what-if, income, merge, debt, style and the rest, one
 * menu item each. Can I afford something is the link under the hero and Add
 * an envelope is the button under the list, so neither repeats here.
 */
export function ManageMenu({
	kind,
	isDebtBook,
	onOpen,
}: {
	kind: MonthKind;
	isDebtBook: boolean;
	onOpen: (sheet: OpenSheet) => void;
}) {
	const t = useTranslations("mobile.budget.manage");
	const rows = manageRows(kind, isDebtBook).filter(
		(row) => row.key !== "afford" && row.key !== "newEnvelope",
	);
	if (rows.length === 0) return null;
	return (
		<Menu
			accessibilityLabel={t("title")}
			items={rows.map((row) => ({
				id: row.key,
				label: t(row.key),
				onPress: () => onOpen(row.sheet),
			}))}
			label={t("more")}
		/>
	);
}
