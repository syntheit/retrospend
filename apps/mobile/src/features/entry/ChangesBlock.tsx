import { View } from "react-native";
import { useTranslations } from "use-intl";
import { TextAction } from "@/features/activity/TextAction";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { useChangeWords } from "./changeWords";
import {
	type ChangeLines,
	changeLines,
	type PreviewState,
	type ShareLine,
	sharesOf,
} from "./preview";

/**
 * What this changes (R30): each place that moves, before Save, then what
 * stays. The numbers are the server's dry run of the same write, formatted
 * here and never computed. A total the server converted at reference rates
 * reads with the approximate mark. A split-expense edit also says whose share
 * moves, from the same dry run. Offline there is no dry run, and the block
 * says the write waits on the phone.
 */
export function ChangesBlock({
	state,
	idle,
	onRetry,
}: {
	state: PreviewState;
	/** What to say before there is anything to preview. */
	idle: string;
	/** Asks the server again after an offline or refused dry run. */
	onRetry?: () => void;
}) {
	const t = useTranslations("mobile.composer.changes");
	const tc = useTranslations("mobile.common");
	const { color, space } = useTheme();
	const { money, marked, name, list } = useChangeWords();
	const lines: ChangeLines | null =
		state.status === "ready" ? changeLines(state.diff) : null;
	const shares: ShareLine[] | null =
		state.status === "ready" ? sharesOf(state.diff) : null;
	const shareText = (s: ShareLine) =>
		s.before && s.after
			? t("shares.change", { before: money(s.before), after: money(s.after) })
			: s.after
				? t("shares.joins", { after: money(s.after) })
				: t("shares.leaves", { before: s.before ? money(s.before) : "" });
	const status =
		state.status === "idle"
			? idle
			: state.status === "loading"
				? t("loading")
				: state.status === "offline"
					? t("offline")
					: state.status === "refused"
						? state.reason === "missingRate"
							? t("noRate", { currency: state.currency })
							: t("refused")
						: null;

	return (
		<View
			accessibilityLiveRegion="polite"
			style={{
				gap: space[2],
				paddingTop: space[3],
				borderTopWidth: 1,
				borderTopColor: color.line,
			}}
		>
			<Text accessibilityRole="header" weight="semibold">
				{t("title")}
			</Text>
			{status ? <Text tone="fg2">{status}</Text> : null}
			{onRetry && (state.status === "offline" || state.status === "refused") ? (
				<View style={{ alignItems: "flex-start" }}>
					<TextAction label={tc("retry")} onPress={onRetry} />
				</View>
			) : null}
			{lines?.moved.map((line) => (
				<View accessible key={line.key}>
					<View
						style={{
							flexDirection: "row",
							justifyContent: "space-between",
							gap: space[3],
						}}
					>
						<Text style={{ flexShrink: 1 }}>{name(line.figure, false)}</Text>
						<Text style={{ textAlign: "right" }} tabular weight="medium">
							{marked(money(line.delta, "exceptZero"), line.approx)}
						</Text>
					</View>
					{line.after ? (
						<Text
							style={{ textAlign: "right" }}
							tabular
							tone="fg2"
							variant="small"
						>
							{t("to", { amount: marked(money(line.after), line.approx) })}
						</Text>
					) : null}
				</View>
			))}
			{shares && shares.length > 0 ? (
				<View style={{ gap: space[2], paddingTop: space[2] }}>
					<Text weight="semibold">{t("shares.title")}</Text>
					{shares.map((s) => (
						<View
							accessible
							key={s.key}
							style={{
								flexDirection: "row",
								justifyContent: "space-between",
								gap: space[3],
							}}
						>
							<Text numberOfLines={1} style={{ flexShrink: 1 }}>
								{s.you ? t("shares.you") : s.name}
							</Text>
							<Text style={{ textAlign: "right" }} tabular>
								{shareText(s)}
							</Text>
						</View>
					))}
					<Text tone="fg2" variant="small">
						{t("shares.told")}
					</Text>
				</View>
			) : null}
			{lines && (lines.stays.length > 0 || lines.moved.length === 0) ? (
				<Text tone="fg2" variant="small">
					{[
						lines.stays.length > 0
							? t("stays", {
									places: list(lines.stays.map((id) => name(id, true))),
								})
							: null,
						lines.moved.length === 0 ? t("nothing") : null,
					]
						.filter(Boolean)
						.join(" ")}
				</Text>
			) : null}
			{shares && shares.length === 0 ? (
				<Text tone="fg2" variant="small">
					{t("shares.same")}
				</Text>
			) : null}
			{lines && lines.unknown.length > 0 ? (
				<Text tone="fg2" variant="small">
					{t("unknown", {
						places: list(lines.unknown.map((id) => name(id, true))),
					})}
				</Text>
			) : null}
		</View>
	);
}
