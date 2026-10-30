import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Hero } from "@/ui/Hero";
import { ListGroup, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import type { OpenSheet } from "./BudgetSheets";
import { monthDate } from "./months";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * Money in this month: what came in as the one number, then what the plan
 * costs against what you usually get, and the way to the income rules. Every
 * figure is the server's; this sheet only words them.
 */
export function IncomeSheet({
	data,
	visible,
	detent = "large",
	onClose,
	onOpen,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onOpen?: (sheet: OpenSheet) => void;
}) {
	const t = useTranslations("mobile.budget.income");
	const tr = useTranslations("mobile.budget.manage");
	const tp = useTranslations("mobile.budget.pool");
	const money = useMoneyText();
	const format = useFormatter();
	const { space } = useTheme();
	const key = data.month.key;
	const read = useSheetRead(
		visible,
		(client) => client.budget.planCost({ month: key }),
		String(key),
	);
	const plan = read.status === "ready" ? read.data : null;
	const month = format.dateTime(monthDate(key), {
		month: "long",
		timeZone: "UTC",
	});
	// One precision down the sheet: every figure shows its minor digits, so
	// "$2,100,000.00" and "-$112,555.56" sit in one column.
	const exact = { cents: true };
	const cost = plan
		? plan.typicalIncome
			? t("planCost", {
					cost: money(plan.cost, exact),
					income: money(plan.typicalIncome, exact),
				})
			: t("planCostOnly", { cost: money(plan.cost, exact) })
		: undefined;
	// Where this month's money went, from the server's own terms: the rows
	// that are zero are left out, and Money in is the hero above them.
	const { terms } = data.toAssign;
	const rows = [
		{
			key: "assigned",
			label: t("terms.assigned"),
			value: terms.assigned,
			always: true,
		},
		{
			key: "assignedAhead",
			label: t("terms.assignedAhead"),
			value: terms.assignedAhead,
		},
		{
			key: "overspendTaken",
			label: t("terms.overspendTaken"),
			value: terms.overspendTaken,
		},
		{ key: "returned", label: t("terms.returned"), value: terms.returned },
		{ key: "splitsNet", label: t("terms.splitsNet"), value: terms.splitsNet },
	].filter((row) => row.always || row.value.minor !== 0);
	return (
		<Sheet
			detents={[detent]}
			onClose={onClose}
			title={t("title", { month })}
			visible={visible}
		>
			<SheetBody>
				<View style={{ paddingHorizontal: space[4] }}>
					<Hero
						label={t("moneyIn")}
						sub={cost}
						tone={data.toAssign.terms.moneyIn.minor > 0 ? "positive" : "fg"}
						value={money(data.toAssign.terms.moneyIn, exact)}
					/>
				</View>
				<ListGroup>
					{rows.map((row) => (
						<ListRow
							accessibilityLabel={`${row.label}, ${money(row.value, exact)}`}
							end={<MoneyAmount cents value={row.value} />}
							key={row.key}
							title={row.label}
						/>
					))}
					<ListRow
						accessibilityLabel={`${tp(data.toAssign.poolName)}, ${money(data.toAssign.amount, exact)}`}
						end={<MoneyAmount cents value={data.toAssign.amount} />}
						title={tp(data.toAssign.poolName)}
					/>
				</ListGroup>
				<View
					style={{
						gap: space[3],
						paddingHorizontal: space[4],
						paddingBottom: space[6],
					}}
				>
					{read.status === "error" ? (
						<Note tone="attention">{t("error")}</Note>
					) : null}
					{plan?.runway ? (
						<Note>
							{t("runway", {
								months: format.number(plan.runway.tenths / 10, {
									maximumFractionDigits: 1,
								}),
								available: money(plan.runway.available, exact),
							})}
						</Note>
					) : null}
					{plan?.incomplete ? <Note>{t("incomplete")}</Note> : null}
					{onOpen ? (
						<View style={{ flexDirection: "row", gap: space[2] }}>
							<Chip
								label={tr("rules")}
								onPress={() => onOpen({ kind: "rules" })}
							/>
						</View>
					) : null}
				</View>
			</SheetBody>
		</Sheet>
	);
}
