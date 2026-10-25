import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { isApproximate } from "./groups";
import type { PersonSummary } from "./source";

type Part = PersonSummary["parts"][number];

/** The size of a balance; its side (owes you, you owe) is said in words beside it. */
function sizeOf(minor: number) {
	return Math.abs(minor);
}

/**
 * A balance in the home currency. It is marked "≈" when currencies were
 * converted (the reference rates, not a settled number), shows "No rate yet"
 * when the server could not convert, and says how many currencies it spans.
 */
export function NetAmount({
	net,
	parts,
	home,
	tone,
	size = "body",
	align = "right",
}: {
	net: { minor: number; currency: string } | null;
	parts: Part[];
	home: string;
	tone: "positive" | "default";
	size?: "body" | "hero";
	align?: "left" | "right";
}) {
	const t = useTranslations("mobile.money");
	const tp = useTranslations("mobile.people");
	const format = useMoneyText();
	const { color, type } = useTheme();
	const hero = size === "hero";
	const text = net
		? format({ minor: sizeOf(net.minor), currency: net.currency })
		: null;
	const shown =
		text === null
			? t("noRate")
			: isApproximate(parts, home)
				? t("approx", { amount: text })
				: text;
	return (
		<View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
			<Text
				numberOfLines={1}
				style={{
					color: tone === "positive" && text ? color.positive : color.fg,
					fontSize: hero ? type.hero.size : type.body.size,
					fontVariant: ["tabular-nums"],
					fontWeight: hero ? "600" : "500",
					textAlign: align,
				}}
			>
				{shown}
			</Text>
			{!hero && parts.length > 1 ? (
				<Text
					numberOfLines={1}
					style={{
						color: color.fg2,
						fontSize: type.small.size,
						textAlign: align,
					}}
				>
					{tp("currencies", { count: parts.length })}
				</Text>
			) : null}
		</View>
	);
}
