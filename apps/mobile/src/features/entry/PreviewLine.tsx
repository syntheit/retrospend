import { useTranslations } from "use-intl";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import { Text } from "@/ui/Text";
import { useChangeWords } from "./changeWords";
import { changeLines, type PreviewState } from "./preview";

/**
 * "What this changes" in one line above the Add bar (R30): the first place
 * that moves and how much, and how many more move. The full list, with what
 * stays, is the last block of More. The numbers are the server's dry run of
 * the same write Add sends. While it is checking, before there is anything
 * to check, and when no figure moves, the line says nothing.
 */
export function PreviewLine({ state }: { state: PreviewState }) {
	const t = useTranslations("mobile.composer.changes");
	const { money, marked } = useChangeWords();
	const label = useFigureLabel();
	if (state.status === "idle" || state.status === "loading") return null;
	let text: string;
	let tone: "fg2" | "attention" = "fg2";
	if (state.status === "offline") text = t("offline");
	else if (state.status === "refused") {
		tone = "attention";
		text =
			state.reason === "missingRate"
				? t("noRate", { currency: state.currency })
				: state.reason === "split"
					? t("splitOff")
					: t("refused");
	} else {
		const { moved } = changeLines(state.diff);
		const first = moved[0];
		if (!first) return null;
		const figure = `${label(first.figure).name} ${marked(
			money(first.delta, "exceptZero"),
			first.approx,
		)}`;
		text =
			moved.length > 1
				? t("oneLineMore", { figure, count: moved.length - 1 })
				: figure;
	}
	return (
		<Text
			accessibilityLiveRegion="polite"
			numberOfLines={1}
			tabular
			tone={tone}
			variant="small"
		>
			{text}
		</Text>
	);
}
