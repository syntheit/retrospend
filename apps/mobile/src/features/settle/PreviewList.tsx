import type { Money } from "@retrospend/domain/money-minor";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import type { PaymentPreview } from "./plan";
import { previewRows } from "./plan";

/**
 * What the payment would change and what it would not, from the server's
 * own dry run of the write (R30). The sheet words the figures; it never
 * computes them.
 */
export function PreviewList({
	preview,
	name,
}: {
	preview: PaymentPreview;
	name: string;
}) {
	const t = useTranslations("mobile.settle");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	// A converted total is an estimate at reference rates: it reads "≈".
	const format = (amount: Money, approx: boolean) =>
		approx ? tm("approx", { amount: money(amount) }) : money(amount);
	const { color, space, type } = useTheme();
	const { changes, kept } = previewRows(preview);

	const label = (figure: string) =>
		t(`figure.${figure.replace(".", "_")}` as "figure.balance_person", {
			name,
		});

	const row = (key: string, left: string, right: string) => (
		<View
			key={key}
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: space[3],
				paddingVertical: space[1],
			}}
		>
			<Text
				style={{ flexShrink: 1, color: color.fg, fontSize: type.body.size }}
			>
				{left}
			</Text>
			<Text
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					textAlign: "right",
				}}
			>
				{right}
			</Text>
		</View>
	);

	return (
		<View style={{ gap: space[3] }}>
			{changes.length > 0 ? (
				<View>
					<Text
						accessibilityRole="header"
						style={{
							color: color.fg2,
							fontSize: type.small.size,
							fontWeight: "600",
						}}
					>
						{t("changes")}
					</Text>
					{changes.map((c) =>
						row(
							`${c.figure}:${c.currency}`,
							label(c.figure),
							t("beforeAfter", {
								before: c.before ? format(c.before, c.approx) : t("none"),
								after: c.after ? format(c.after, c.approx) : t("none"),
							}),
						),
					)}
				</View>
			) : null}
			{kept.length > 0 ? (
				<View>
					<Text
						accessibilityRole="header"
						style={{
							color: color.fg2,
							fontSize: type.small.size,
							fontWeight: "600",
						}}
					>
						{t("stays")}
					</Text>
					{kept.map((k) =>
						row(
							k.figure,
							label(k.figure),
							k.lines.length > 0
								? k.lines
										.map((line) =>
											t("keeps", { amount: format(line, k.approx) }),
										)
										.join(", ")
								: t("none"),
						),
					)}
				</View>
			) : null}
		</View>
	);
}
