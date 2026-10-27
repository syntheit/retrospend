import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { CategoryTile, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import type { PersonPage } from "./source";

type Scope = PersonPage["scopes"][number];
type Payment = PersonPage["payments"][number];
export type LedgerRow = PersonPage["rows"][number];

/** A day as the server sent it, shown short in the phone's language. */
function useShortDay() {
	const format = useFormatter();
	return (day: string) => {
		const [y, m, d] = day.split("-").map(Number) as [number, number, number];
		return format.dateTime(new Date(y, m - 1, d, 12), {
			month: "short",
			day: "numeric",
		});
	};
}

/** One project (or Outside projects) and what is open in it. */
export function ScopeRow({ scope }: { scope: Scope }) {
	const t = useTranslations("mobile.person");
	const format = useMoneyText();
	const { color, type } = useTheme();
	const name = scope.project?.name ?? t("outside");
	const spoken =
		scope.lines.length === 0
			? t("scopeSettled")
			: scope.lines
					.map(
						(line) =>
							`${line.minor > 0 ? t("scopeOwesYou") : t("scopeYouOwe")} ${format(
								{
									minor: Math.abs(line.minor),
									currency: line.currency,
								},
							)}`,
					)
					.join(", ");
	return (
		<ListRow accessibilityLabel={`${name}, ${spoken}`}>
			<Text style={{ flex: 1, color: color.fg, fontSize: type.body.size }}>
				{name}
			</Text>
			{scope.lines.length === 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("scopeSettled")}
				</Text>
			) : (
				<View style={{ alignItems: "flex-end" }}>
					{scope.lines.map((line) => (
						<View key={line.currency} style={{ alignItems: "flex-end" }}>
							<Text style={{ color: color.fg2, fontSize: type.small.size }}>
								{line.minor > 0 ? t("scopeOwesYou") : t("scopeYouOwe")}
							</Text>
							<MoneyAmount
								tone={line.minor > 0 ? "positive" : "default"}
								value={{ minor: Math.abs(line.minor), currency: line.currency }}
							/>
						</View>
					))}
				</View>
			)}
		</ListRow>
	);
}

/** A payment between you: who paid, when, and whether it is confirmed. */
export function PaymentRow({ payment }: { payment: Payment }) {
	const t = useTranslations("mobile.person");
	const day = useShortDay();
	const { color, type } = useTheme();
	const parts = [
		day(payment.paidOn),
		payment.method,
		payment.status === "pending" ? t("paymentPending") : t("paymentFinal"),
		payment.parts.some((p) => p.offset) ? t("offset") : null,
	].filter((part): part is string => Boolean(part));
	const title =
		payment.direction === "out" ? t("paymentSent") : t("paymentReceived");
	return (
		<ListRow accessibilityLabel={`${title}, ${parts.join(", ")}`}>
			<View style={{ flex: 1, gap: 2 }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{title}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{parts.join(" · ")}
				</Text>
			</View>
			<MoneyAmount value={payment.amount} />
		</ListRow>
	);
}

/** A shared expense between you: what it was, who paid, what it does to the balance. */
export function SharedRow({ row }: { row: LedgerRow }) {
	const t = useTranslations("mobile.person");
	const day = useShortDay();
	const format = useMoneyText();
	const { color, type } = useTheme();
	const state = row.state === "ok" ? null : t(`state.${row.state}`);
	const paidBy =
		row.paidBy === "me"
			? t("paidByMe")
			: t("paidByName", { name: row.payerName });
	const sub = [paidBy, row.category?.name ?? null, day(row.date)].filter(
		(part): part is string => Boolean(part),
	);
	const effect = row.effect
		? row.effect.minor > 0
			? t("effectThem", {
					amount: format({
						minor: row.effect.minor,
						currency: row.effect.currency,
					}),
				})
			: t("effectYou", {
					amount: format({
						minor: Math.abs(row.effect.minor),
						currency: row.effect.currency,
					}),
				})
		: null;
	return (
		<ListRow
			accessibilityLabel={[row.title, state, ...sub, effect]
				.filter(Boolean)
				.join(", ")}
		>
			<CategoryTile category={row.category} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{row.title}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{state ? (
						<Text style={{ color: color.attentionText, fontWeight: "500" }}>
							{state}
							{" · "}
						</Text>
					) : null}
					{sub.join(" · ")}
				</Text>
			</View>
			<View style={{ alignItems: "flex-end", gap: 2 }}>
				<MoneyAmount value={row.amount} />
				{effect ? (
					<Text
						style={{
							color:
								row.effect && row.effect.minor > 0 ? color.positive : color.fg2,
							fontSize: type.small.size,
						}}
					>
						{effect}
					</Text>
				) : null}
			</View>
		</ListRow>
	);
}
