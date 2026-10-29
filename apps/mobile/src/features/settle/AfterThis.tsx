import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { balanceAfter, type Direction, type PaymentPreview } from "./plan";
import type { Overpaid } from "./useSettle";

/**
 * The balance with the person once the payment is recorded, in words, from
 * the server's own dry run ("After this: settled with Martín"), and the one
 * rule of the record under it: whether it is final or waits for them.
 */
export function AfterThis({
	preview,
	name,
	direction,
	onRetrospend,
}: {
	preview: PaymentPreview;
	name: string;
	direction: Direction;
	/** The other person has an account: a payment you made waits for them. */
	onRetrospend: boolean;
}) {
	const t = useTranslations("mobile.settle");
	const money = useMoneyText();
	const { space } = useTheme();
	const open = balanceAfter(preview);
	const owesYou = open.filter((line) => line.minor > 0);
	const youOwe = open.filter((line) => line.minor < 0);
	const list = (lines: typeof open) =>
		lines
			.map((line) =>
				money({ minor: Math.abs(line.minor), currency: line.currency }),
			)
			.join(" + ");
	const state =
		open.length === 0
			? t("afterSettled", { name })
			: [
					owesYou.length > 0
						? t("afterOwesYou", { name, amount: list(owesYou) })
						: null,
					youOwe.length > 0
						? t("afterYouOwe", { name, amount: list(youOwe) })
						: null,
				]
					.filter((part) => part !== null)
					.join("; ");
	const rule =
		direction === "incoming"
			? t("rule.received")
			: onRetrospend
				? t("rule.waits", { name })
				: t("rule.final", { name });
	return (
		<View style={{ gap: space[1] }}>
			<Text weight="medium">{t("afterThis", { state })}</Text>
			<Text tone="fg3" variant="meta">
				{rule}
			</Text>
		</View>
	);
}

/**
 * More than is owed: by how much, and the exact payment as one action. The
 * server refuses the extra, so the sheet offers what it will take.
 */
export function OverpayAction({
	overpaid,
	name,
	direction,
	converts,
	onExact,
}: {
	overpaid: Overpaid | null;
	name: string;
	direction: Direction;
	converts: boolean;
	onExact: () => void;
}) {
	const t = useTranslations("mobile.settle");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const { space } = useTheme();
	if (!overpaid?.over) {
		return <Text tone="attention">{t("overpay")}</Text>;
	}
	const exact = overpaid.exact
		? converts
			? tm("approx", { amount: money(overpaid.exact) })
			: money(overpaid.exact)
		: null;
	return (
		<View accessibilityRole="alert" style={{ gap: space[2] }}>
			<Text tone="attention" weight="medium">
				{t(direction === "incoming" ? "overTheyOwe" : "overYouOwe", {
					name,
					amount: money(overpaid.over),
				})}
			</Text>
			{exact ? (
				<View style={{ flexDirection: "row" }}>
					<Button
						label={t("recordExact", { amount: exact })}
						onPress={onExact}
						size="small"
						variant="outlined"
					/>
				</View>
			) : null}
		</View>
	);
}
