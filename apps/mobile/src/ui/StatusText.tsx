import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { type Theme, useTheme } from "@/theme";

/**
 * The tones of the one status map (R5), the same as the web's
 * `components/ui/status-map.ts`. Positive is money to you, attention needs
 * the person, info is in flight, danger failed, owe is money from you,
 * quiet and muted are done or out of play.
 */
export type StatusTone =
	| "positive"
	| "attention"
	| "info"
	| "danger"
	| "owe"
	| "quiet"
	| "muted";

/** Each status kind's tone. The word is `mobile.status.<kind>`. */
export const STATUS = {
	owed: "positive",
	owe: "owe",
	settled: "muted",
	funded: "positive",
	underfunded: "attention",
	overspent: "attention",
	pending: "info",
	confirmed: "quiet",
	overdue: "attention",
	due: "attention",
	review: "attention",
	importing: "info",
	error: "danger",
	notOnRetrospend: "muted",
	upcoming: "quiet",
	noRate: "attention",
	rejected: "muted",
	notCounted: "muted",
	spread: "quiet",
} as const satisfies Record<string, StatusTone>;

export type StatusKind = keyof typeof STATUS;

/** The dot and the word's colors for a tone, from the theme tokens. */
export function toneColors(
	color: Theme["color"],
	tone: StatusTone,
): { dot: string; text: string } {
	switch (tone) {
		case "positive":
			return { dot: color.positive, text: color.positive };
		case "attention":
			return { dot: color.attention, text: color.attentionText };
		case "info":
			return { dot: color.info, text: color.info };
		case "danger":
			return { dot: color.danger, text: color.danger };
		case "owe":
			return { dot: color.fg2, text: color.owe };
		case "quiet":
			return { dot: color.fg3, text: color.fg2 };
		case "muted":
			return { dot: color.fg3, text: color.fg3 };
	}
}

/**
 * A status as an 8pt dot plus its word, never color alone (R5). Give a
 * `kind` for the map's word, or a `tone` and a `label` for a more specific
 * one ("2 need you"); a `label` also overrides a kind's word. Default 13,
 * `sm` 12 for a row's sub line.
 */
export function StatusText({
	kind,
	tone,
	label,
	size = "default",
}: (
	| { kind: StatusKind; tone?: undefined }
	| { kind?: undefined; tone: StatusTone }
) & {
	label?: string;
	size?: "default" | "sm";
}) {
	const t = useTranslations("mobile.status");
	const { color, space, type } = useTheme();
	const colors = toneColors(color, kind ? STATUS[kind] : (tone ?? "quiet"));
	const word = label ?? (kind ? t(kind) : "");
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					width: space[2],
					height: space[2],
					borderRadius: space[1],
					backgroundColor: colors.dot,
				}}
			/>
			<Text
				numberOfLines={1}
				style={{
					color: colors.text,
					fontSize: size === "sm" ? type.meta.size : type.small.size,
				}}
			>
				{word}
			</Text>
		</View>
	);
}
