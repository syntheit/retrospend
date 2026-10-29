import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Text } from "@/ui/Text";
import { isApproximate } from "./groups";
import type { PersonSummary } from "./source";

type Part = PersonSummary["parts"][number];
type Net = { minor: number; currency: string } | null;

/** A balance worded: "≈ ARS 1,000", or "No rate yet" when it cannot be had. */
export function useNetText() {
	const t = useTranslations("mobile.money");
	const format = useMoneyText();
	// The size of a balance; its side (owes you, you owe) is said in words.
	return (net: Net, parts: { amount: Part["amount"] }[], home: string) => {
		if (!net) return t("noRate");
		const text = format({ minor: Math.abs(net.minor), currency: net.currency });
		return isApproximate(parts, home) ? t("approx", { amount: text }) : text;
	};
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
	showCount = true,
}: {
	net: Net;
	parts: Part[];
	home: string;
	tone: "positive" | "default";
	size?: "body" | "hero";
	align?: "left" | "right";
	/** Says how many currencies it spans; off for a total of many people. */
	showCount?: boolean;
}) {
	const tp = useTranslations("mobile.people");
	const netText = useNetText();
	const hero = size === "hero";
	return (
		<View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
			<Text
				numberOfLines={1}
				style={{ textAlign: align }}
				tabular
				tone={tone === "positive" && net ? "positive" : "fg"}
				variant={hero ? "hero" : "body"}
				weight={hero ? "semibold" : "medium"}
			>
				{netText(net, parts, home)}
			</Text>
			{showCount && !hero && parts.length > 1 ? (
				<Text
					numberOfLines={1}
					style={{ textAlign: align }}
					tone="fg2"
					variant="small"
				>
					{tp("currencies", { count: parts.length })}
				</Text>
			) : null}
		</View>
	);
}
