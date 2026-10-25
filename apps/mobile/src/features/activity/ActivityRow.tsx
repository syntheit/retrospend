import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { CategoryTile, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import type { ActivityItem } from "./source";

type Words = ReturnType<typeof useTranslations<"mobile.activity">>;

/** The row's headline: payments have no title, so they say who paid whom. */
export function rowTitle(item: ActivityItem, t: Words): string {
	if (item.kind !== "payment" || !item.payment) return item.title;
	return item.payment.direction === "sent"
		? t("row.paymentSent", { name: item.payment.counterparty })
		: t("row.paymentReceived", { name: item.payment.counterparty });
}

/** A status is a word, never color alone (GUIDELINE §2.1). */
export function rowStatus(item: ActivityItem, t: Words): string | null {
	if (item.waiting === "review") return t("row.review");
	if (item.waiting === "rejected") return t("row.rejected");
	if (item.pending) return t("row.pending");
	return null;
}

function kindWord(item: ActivityItem, t: Words): string | null {
	switch (item.kind) {
		case "income":
			return t("row.income");
		case "refund":
			return t("row.refund");
		case "transfer":
			return t("row.transfer");
		default:
			return null;
	}
}

/**
 * The entry row: category tile, title, a subline (status word, kind,
 * category, who it is with), and the amount on the right in its original
 * currency with the home value under it. A split shows your share.
 */
export function ActivityRow({
	item,
	onPress,
	selected,
}: {
	item: ActivityItem;
	onPress?: () => void;
	selected?: boolean;
}) {
	const t = useTranslations("mobile.activity");
	const tm = useTranslations("mobile.money");
	const { color, space, type } = useTheme();
	const format = useMoneyText();
	const faces = useFaces();
	const status = rowStatus(item, t);
	const title = rowTitle(item, t);
	const sub = [kindWord(item, t), item.category?.name ?? null].filter(
		(part): part is string => Boolean(part),
	);
	const others = (item.people ?? []).filter((p) => !p.isSelf);
	const income = item.kind === "income" || item.kind === "refund";
	const share = item.share ? format(item.share) : null;

	return (
		<ListRow
			accessibilityLabel={[
				title,
				status,
				format(item.amount),
				share ? tm("yourShare", { amount: share }) : null,
			]
				.filter(Boolean)
				.join(", ")}
			onPress={onPress}
			selected={selected}
		>
			<CategoryTile label={title} tone={item.category?.tone ?? null} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{title}
				</Text>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Text
						numberOfLines={1}
						style={{
							flexShrink: 1,
							color: color.fg2,
							fontSize: type.small.size,
						}}
					>
						{status ? (
							<Text style={{ color: color.attentionText, fontWeight: "500" }}>
								{status}
							</Text>
						) : null}
						{status && sub.length > 0 ? " · " : ""}
						{sub.join(" · ")}
					</Text>
					{others.length > 0 ? (
						<AvatarStack
							faces={faces(
								others.map((p) => ({
									key: p.id,
									name: p.name,
									imageUrl: p.imageUrl,
								})),
							)}
							size="xs"
						/>
					) : null}
				</View>
			</View>
			<View style={{ alignItems: "flex-end", gap: 2 }}>
				<MoneyAmount
					home={item.home}
					rateType={item.rateType}
					sign={income ? "exceptZero" : "auto"}
					tone={income ? "positive" : "default"}
					value={item.amount}
				/>
				{share ? (
					<Text
						numberOfLines={1}
						style={{ color: color.fg2, fontSize: type.small.size }}
					>
						{tm("yourShare", { amount: share })}
					</Text>
				) : null}
			</View>
		</ListRow>
	);
}
