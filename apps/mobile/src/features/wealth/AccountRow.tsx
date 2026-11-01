import { formatPercent } from "@retrospend/domain/format-percent";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { IconTile } from "@/ui/IconTile";
import { ListRow } from "@/ui/List";
import { useRateFormat } from "@/lib/rateFormat";
import { MoneyAmount, useRateTypeLabel } from "@/ui/Money";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import { aprBasis, glyphOf, isLiability } from "./accounts";
import type { AccountRowActions } from "./actions";
import { valuedAt } from "./rateType";
import type { Account } from "./source";

/**
 * One account (GUIDELINE 4): a neutral tile for its kind, the name at 500, a
 * sub line of its currency, the rate type it is valued at and when it last
 * changed, and what it holds at the end with its home value under it. A
 * currency with no rate says so inline and "Not counted", never 1. A loan or
 * card says "You owe" so it never reads as an asset. The row taps to its
 * page; its swipes and long-press menu are the account actions.
 */
export function AccountRow({
	account,
	onPress,
	actions,
}: {
	account: Account;
	onPress: () => void;
	actions: AccountRowActions;
}) {
	const t = useTranslations("mobile.wealth");
	const notCounted = useTranslations("mobile.status")("notCounted");
	const format = useFormatter();
	const locale = useMoneyLocale();
	const money = useMoneyText();
	const rateName = useRateTypeLabel();
	const rateFmt = useRateFormat();
	const { space } = useTheme();
	const closed = account.closedAt !== null;
	const missing = account.value === null && !closed;
	const foreign =
		account.value !== null &&
		account.value.currency !== account.balance.currency;
	const day = (iso: string) =>
		format.dateTime(new Date(iso), { month: "short", day: "numeric" });
	const apr = aprBasis(account.interestRate);
	// The type never shows without its number (R8).
	const valued = valuedAt(account);
	const valuedText =
		valued && account.value
			? rateFmt.typed(
					rateName(valued),
					account.balance.currency,
					account.value.currency,
					account.rate,
				)
			: null;
	const terms =
		apr !== null
			? t("apr", { rate: formatPercent(apr, { locale, digits: 2 }) })
			: valuedText
				? t("valuedAt", { type: valuedText })
				: null;
	const bits = closed
		? [
				account.balance.currency,
				t("closed.on", { date: day(account.closedAt ?? account.updatedAt) }),
			]
		: missing
			? [account.balance.currency]
			: [
					account.balance.currency,
					isLiability(account.type) ? t("owes") : null,
					terms,
					day(account.updatedAt),
				];
	const line = bits.filter(Boolean).join(" · ");
	const spoken = [
		account.name,
		line,
		money(account.balance),
		missing ? notCounted : account.value ? money(account.value) : null,
	]
		.filter(Boolean)
		.join(", ");
	return (
		<SwipeRow
			leading={actions.leading}
			menu={actions.menu}
			menuTitle={account.name}
			onPress={onPress}
			trailing={actions.trailing}
		>
			<ListRow
				accessibilityLabel={spoken}
				end={
					<View style={{ alignItems: "flex-end", gap: space[1] }}>
						<MoneyAmount
							home={foreign && !closed ? account.value : undefined}
							tone={closed ? "muted" : "default"}
							value={account.balance}
						/>
						{missing ? (
							<Text tone="attention" variant="meta">
								{notCounted}
							</Text>
						) : null}
					</View>
				}
				lead={<IconTile name={glyphOf(account.type)} />}
				sub={
					<Text numberOfLines={1} tone="fg3" variant="meta">
						{line}
						{missing ? (
							<Text tone="attention" variant="meta">
								{" · "}
								{t("noRateInline", { currency: account.balance.currency })}
							</Text>
						) : null}
					</Text>
				}
				title={account.name}
			/>
		</SwipeRow>
	);
}
