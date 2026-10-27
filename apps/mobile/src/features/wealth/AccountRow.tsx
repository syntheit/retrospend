import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { isLiability } from "./accounts";
import type { Account } from "./source";

/**
 * One account: its name and kind, what it holds in its own currency and what
 * that is worth at home. A currency with no rate reads "No rate yet", never 1;
 * a loan or card says "You owe" next to the amount so it never reads as an
 * asset.
 */
export function AccountRow({
	account,
	onPress,
	selected,
}: {
	account: Account;
	onPress: () => void;
	selected?: boolean;
}) {
	const t = useTranslations("mobile.wealth");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const liability = isLiability(account.type);
	const closed = account.closedAt !== null;
	// A foreign balance shows the rate type it is valued at (GUIDELINE 7).
	const foreign =
		account.value !== null &&
		account.value.currency !== account.balance.currency;
	const kind = [
		t(`types.${account.type}`),
		liability ? t("owes") : null,
		closed ? t("closed.badge") : null,
	]
		.filter(Boolean)
		.join(" · ");
	const spoken = [
		account.name,
		kind,
		money(account.balance),
		account.value ? money(account.value) : tm("noRate"),
	].join(", ");
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress} selected={selected}>
			<View style={{ flex: 1, gap: space[1] }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{account.name}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{kind}
				</Text>
			</View>
			<MoneyAmount
				home={account.value}
				rateType={foreign ? (account.rateType ?? undefined) : undefined}
				tone={closed ? "muted" : "default"}
				value={account.balance}
			/>
		</ListRow>
	);
}
