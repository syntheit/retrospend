import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { type ChangeLines, changeLines, type PreviewState } from "./preview";

/**
 * What this changes (R30): each place that moves, before Save, then what
 * stays. The numbers are the server's dry run of the same write, formatted
 * here and never computed. Offline there is no dry run, and the block says
 * the write waits on the phone.
 */
export function ChangesBlock({
	state,
	idle,
}: {
	state: PreviewState;
	/** What to say before there is anything to preview. */
	idle: string;
}) {
	const t = useTranslations("mobile.entry.changes");
	const { color, space, type } = useTheme();
	const { format } = useFormatMoney();
	const lines: ChangeLines | null =
		state.status === "ready" ? changeLines(state.diff) : null;

	// Figure ids have dots, which message keys cannot.
	const name = (id: string, inline: boolean) => {
		const key = `${inline ? "figuresInline" : "figures"}.${id.replaceAll(".", "_")}`;
		// The key is built at run time, so it can not be checked against the catalog.
		return t.has(key as never) ? t(key as never) : id;
	};
	const status =
		state.status === "idle"
			? idle
			: state.status === "loading"
				? t("loading")
				: state.status === "offline"
					? t("offline")
					: state.status === "refused"
						? t("refused")
						: null;

	return (
		<View accessibilityLiveRegion="polite" style={{ gap: space[2] }}>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{t("title")}
			</Text>
			{status ? (
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{status}
				</Text>
			) : null}
			{lines?.moved.map((line) => (
				<View
					accessible
					key={line.key}
					style={{
						flexDirection: "row",
						justifyContent: "space-between",
						gap: space[3],
					}}
				>
					<Text style={{ color: color.fg, fontSize: type.body.size }}>
						{name(line.figure, false)}
					</Text>
					<Text
						style={{
							color: color.fg,
							fontSize: type.body.size,
							fontVariant: ["tabular-nums"],
							fontWeight: "500",
							textAlign: "right",
						}}
					>
						{format(line.delta, { sign: "exceptZero" }) ?? ""}
						{line.after ? (
							<Text style={{ color: color.fg2, fontWeight: "400" }}>
								{` ${t("to", { amount: format(line.after) ?? "" })}`}
							</Text>
						) : null}
					</Text>
				</View>
			))}
			{lines && lines.stays.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("stays", {
						places: lines.stays.map((id) => name(id, true)).join(", "),
					})}
				</Text>
			) : null}
			{lines && lines.unknown.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("unknown", {
						places: lines.unknown.map((id) => name(id, true)).join(", "),
					})}
				</Text>
			) : null}
			{lines && lines.moved.length === 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("nothing")}
				</Text>
			) : null}
		</View>
	);
}
