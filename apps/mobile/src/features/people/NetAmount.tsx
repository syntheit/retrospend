import { View } from "react-native";
import { useTranslations } from "use-intl";
import { heroCents, MoneyAmount } from "@/ui/Money";
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

/** The same balance for the Hero: the hero's cents rule, "≈" when converted. */
export function useNetHeroText() {
	const t = useTranslations("mobile.money");
	const format = useMoneyText();
	return (net: Net, parts: { amount: Part["amount"] }[], home: string) => {
		if (!net) return t("noRate");
		const text = format(
			{ minor: Math.abs(net.minor), currency: net.currency },
			{ cents: heroCents(net.currency) },
		);
		return isApproximate(parts, home) ? t("approx", { amount: text }) : text;
	};
}

/**
 * A balance in the home currency, composed from MoneyAmount at weight 600.
 * It is marked "≈" when currencies were converted (the reference rates, not a
 * settled number), shows "No rate yet" when the server could not convert, and
 * says how many currencies it spans.
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
	const t = useTranslations("mobile.money");
	const format = useMoneyText();
	const hero = size === "hero";
	const approx = isApproximate(parts, home);
	return (
		<View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
			{net && approx && !hero ? (
				// A converted total is an estimate: whole units, no cents.
				<Text
					numberOfLines={1}
					style={{ textAlign: align }}
					tabular
					tone={tone === "positive" ? "positive" : "fg"}
					weight="semibold"
				>
					{t("approx", {
						amount: format(
							{ minor: Math.abs(net.minor), currency: net.currency },
							{ cents: false },
						),
					})}
				</Text>
			) : net ? (
				<MoneyAmount
					align={align}
					approx={approx}
					size={hero ? "hero" : "body"}
					strong
					tone={tone}
					value={{ minor: Math.abs(net.minor), currency: net.currency }}
				/>
			) : (
				<Text
					numberOfLines={1}
					style={{ textAlign: align }}
					tabular
					variant={hero ? "hero" : "body"}
					weight="semibold"
				>
					{t("noRate")}
				</Text>
			)}
			{showCount && !hero && parts.length > 1 ? (
				<Text
					numberOfLines={1}
					style={{ textAlign: align }}
					tone="fg3"
					variant="meta"
				>
					{tp("currencies", { count: parts.length })}
				</Text>
			) : null}
		</View>
	);
}
