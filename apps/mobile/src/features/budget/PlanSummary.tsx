import { router } from "expo-router";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { AvatarStack, type Face } from "@/ui/Avatar";
import { Glyph } from "@/ui/Glyph";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { participantKey } from "./owedBodies";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * The people who owe you, as faces for the Owed row. The month's summary has
 * only a count, so this reads the owed list when someone owes; until it
 * arrives the row shows without faces.
 */
function useOwedFaces(people: number, held: number): Face[] {
	const t = useTranslations("mobile.budget.owed");
	const read = useSheetRead(
		people > 0,
		(client) => client.budget.owed(),
		`${people}:${held}`,
	);
	if (read.status !== "ready" || !read.data) return [];
	return read.data.people
		.filter((p) => p.held.minor > 0)
		.map((p) => ({
			key: participantKey(p.participant),
			name: p.name ?? t("someone"),
		}));
}

/**
 * The pool (Not planned yet, or To assign) and what people owe you, as rows
 * of one list. Limits books have no pool: nothing there is assigned (SPEC
 * 6.1). Every figure is the month's own. The Owed row leads with faces, its
 * amount is positive and approximate ("≈", it is held at today's rates), and
 * it opens who owes you.
 */
export function PlanSummary({
	data,
	onUsePlan,
	onOpenOwed,
}: {
	data: BudgetMonth;
	/** Set when Use my plan can run here: an open month with money to plan. */
	onUsePlan: (() => void) | null;
	/** Set in the open month: Owed opens its sheet; otherwise it goes to People. */
	onOpenOwed: (() => void) | null;
}) {
	const t = useTranslations("mobile.budget");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const { format } = useFormatMoney();
	const { color, size, space } = useTheme();
	const owed = data.owed;
	const faces = useOwedFaces(owed.people, owed.held.minor);
	const pool = t(`pool.${data.toAssign.poolName}`);
	const poolText = money(data.toAssign.amount);
	// The pool is said once: by the hero (To assign leads) or by the notice.
	const showPool = !(
		data.book.style === "LIMITS" ||
		data.verdict.lead.kind === "TO_ASSIGN" ||
		data.verdict.notice?.kind === "NOT_PLANNED_YET"
	);
	const owedSpoken = `${t("owed.title")}, ${t("owed.people", { count: owed.people })}, ${money(owed.held)}`;
	return (
		<View style={{ paddingTop: space[4] }}>
			<ListGroup>
				{showPool ? (
					<ListRow
						accessibilityLabel={`${pool}, ${poolText}`}
						end={<MoneyAmount value={data.toAssign.amount} />}
						onPress={
							onUsePlan && data.toAssign.amount.minor > 0
								? onUsePlan
								: undefined
						}
						title={pool}
					/>
				) : null}
				{owed.people > 0 ? (
					<ListRow
						accessibilityLabel={owedSpoken}
						lead={
							faces.length > 0 ? (
								<AvatarStack faces={faces} max={3} ring="surface" size="sm" />
							) : undefined
						}
						onPress={
							onOpenOwed ??
							(() =>
								router.navigate({
									pathname: "/people",
									params: { segment: "people" },
								}))
						}
					>
						{/* The title keeps its width; the amount shrinks first, and shows whole units. */}
						<View style={{ flexShrink: 0 }}>
							<Text numberOfLines={1} weight="medium">
								{t("owed.title")}
							</Text>
							<Text numberOfLines={1} tone="fg3" variant="meta">
								{t("owed.people", { count: owed.people })}
							</Text>
						</View>
						<View style={{ flex: 1, minWidth: 0 }}>
							<Text
								adjustsFontSizeToFit
								numberOfLines={1}
								style={{ textAlign: "right" }}
								tabular
								tone="positive"
								weight="medium"
							>
								{tm("approx", {
									amount: format(owed.held, { cents: false }) ?? "",
								})}
							</Text>
						</View>
						<Glyph
							color={color.fg3}
							name="ChevronRight"
							size={size.icon.phone}
						/>
					</ListRow>
				) : null}
			</ListGroup>
		</View>
	);
}
