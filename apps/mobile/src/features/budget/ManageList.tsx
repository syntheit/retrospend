import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { ListRow } from "@/features/read/parts";
import { useTheme } from "@/theme";
import type { OpenSheet } from "./BudgetSheets";
import type { MonthKind } from "./months";

type RowKey =
	| "afford"
	| "newEnvelope"
	| "merge"
	| "payDebt"
	| "reconcile"
	| "style";

/** The sheets the list below the envelopes opens, by month kind (closed months are read-only). */
export function manageRows(
	kind: MonthKind,
	isDebtBook: boolean,
): { key: RowKey; sheet: OpenSheet }[] {
	if (kind === "closed") return [];
	const rows: { key: RowKey; sheet: OpenSheet }[] = [
		{ key: "afford", sheet: { kind: "afford" } },
	];
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

/** Plan and tidy: what-if, envelopes, debt and style. One row each, one sheet each. */
export function ManageList({
	kind,
	isDebtBook,
	onOpen,
}: {
	kind: MonthKind;
	isDebtBook: boolean;
	onOpen: (sheet: OpenSheet) => void;
}) {
	const t = useTranslations("mobile.budget.manage");
	const { color, space, type } = useTheme();
	const rows = manageRows(kind, isDebtBook);
	if (rows.length === 0) return null;
	return (
		<View style={{ paddingTop: space[4] }}>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg2,
					fontSize: type.small.size,
					paddingHorizontal: space[4],
					paddingBottom: space[1],
				}}
			>
				{t("title")}
			</Text>
			{rows.map((row) => (
				<ListRow
					accessibilityLabel={t(row.key)}
					key={row.key}
					onPress={() => onOpen(row.sheet)}
				>
					<Text
						style={{ flex: 1, color: color.brand, fontSize: type.body.size }}
					>
						{t(row.key)}
					</Text>
				</ListRow>
			))}
		</View>
	);
}
