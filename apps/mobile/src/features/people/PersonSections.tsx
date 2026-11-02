import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { dayDate } from "@/lib/days";
import { IconTile } from "@/ui/IconTile";
import { CategoryTile, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import type { PersonPage } from "./source";

type Scope = PersonPage["scopes"][number];
type Payment = PersonPage["payments"][number];
export type LedgerRow = PersonPage["rows"][number];

/** A day as the server sent it, shown short in the phone's language. */
function useShortDay() {
	const format = useFormatter();
	return (day: string) => {
		return format.dateTime(dayDate(day), {
			month: "short",
			day: "numeric",
		});
	};
}

/**
 * One project (or Outside projects) and what is open in it, or a Settled
 * status when nothing is.
 */
export function ScopeRow({ scope }: { scope: Scope }) {
	const t = useTranslations("mobile.person");
	const format = useMoneyText();
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
		<ListRow
			accessibilityLabel={`${name}, ${spoken}`}
			end={
				scope.lines.length === 0 ? (
					<StatusText kind="settled" size="sm" />
				) : (
					<View style={{ alignItems: "flex-end" }}>
						{scope.lines.map((line) => (
							<View key={line.currency} style={{ alignItems: "flex-end" }}>
								<Text tone={line.minor > 0 ? "positive" : "fg2"} variant="meta">
									{line.minor > 0 ? t("scopeOwesYou") : t("scopeYouOwe")}
								</Text>
								<MoneyAmount
									strong
									tone={line.minor > 0 ? "positive" : "default"}
									value={{
										minor: Math.abs(line.minor),
										currency: line.currency,
									}}
								/>
							</View>
						))}
					</View>
				)
			}
			title={name}
		/>
	);
}

/** A payment between you: who paid, when, and whether it is confirmed. */
export function PaymentRow({ payment }: { payment: Payment }) {
	const t = useTranslations("mobile.person");
	const day = useShortDay();
	const parts = [
		day(payment.paidOn),
		payment.method,
		payment.status === "pending" ? t("paymentPending") : t("paymentFinal"),
		payment.parts.some((p) => p.offset) ? t("offset") : null,
	].filter((part): part is string => Boolean(part));
	const title =
		payment.direction === "out" ? t("paymentSent") : t("paymentReceived");
	return (
		<ListRow
			accessibilityLabel={`${title}, ${parts.join(", ")}`}
			end={<MoneyAmount value={payment.amount} />}
			lead={<IconTile name="Banknote" />}
			sub={parts.join(" · ")}
			title={title}
		/>
	);
}

/** A shared expense between you: what it was, who paid, what it does to the balance. */
export function SharedRow({ row }: { row: LedgerRow }) {
	const t = useTranslations("mobile.person");
	const day = useShortDay();
	const format = useMoneyText();
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
			end={
				<View style={{ alignItems: "flex-end" }}>
					<MoneyAmount value={row.amount} />
					{effect ? (
						<Text
							tone={row.effect && row.effect.minor > 0 ? "positive" : "fg2"}
							variant="meta"
						>
							{effect}
						</Text>
					) : null}
				</View>
			}
			lead={<CategoryTile category={row.category} />}
			sub={
				<Text numberOfLines={1} tone="fg3" variant="meta">
					{state ? (
						<Text tone="attention" variant="meta" weight="medium">
							{`${state} · `}
						</Text>
					) : null}
					{sub.join(" · ")}
				</Text>
			}
			title={row.title}
		/>
	);
}
