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
	const tl = useTranslations("mobile.entry.list");
	const { color, space, type } = useTheme();
	const { format } = useFormatMoney();
	const lines: ChangeLines | null =
		state.status === "ready" ? changeLines(state.diff) : null;
	// One precision down a column: every amount shows its minor digits.
	const money = (
		value: { minor: number; currency: string },
		sign?: "exceptZero",
	) => format(value, { cents: true, sign }) ?? "";

	// Figure ids have dots, which message keys cannot. An id with no name of
	// its own reads "another figure", never the id.
	const name = (id: string, inline: boolean) => {
		const group = inline ? "figuresInline" : "figures";
		const key = `${group}.${id.replaceAll(".", "_")}`;
		// The key is built at run time, so it can not be checked against the catalog.
		return t.has(key as never) ? t(key as never) : t(`${group}.other` as never);
	};
	// A list in the person's language: the words between items are messages.
	const list = (items: string[]) => {
		if (items.length < 2) return items[0] ?? "";
		if (items.length === 2) {
			return tl("two", { first: items[0] ?? "", second: items[1] ?? "" });
		}
		return tl("many", {
			rest: items.slice(0, -1).join(tl("separator")),
			last: items[items.length - 1] ?? "",
		});
	};
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
				<View accessible key={line.key}>
					<View
						style={{
							flexDirection: "row",
							justifyContent: "space-between",
							gap: space[3],
						}}
					>
						<Text
							style={{
								flexShrink: 1,
								color: color.fg,
								fontSize: type.body.size,
							}}
						>
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
							{money(line.delta, "exceptZero")}
						</Text>
					</View>
					{line.after ? (
						<Text
							style={{
								color: color.fg2,
								fontSize: type.small.size,
								fontVariant: ["tabular-nums"],
								textAlign: "right",
							}}
						>
							{t("to", { amount: money(line.after) })}
						</Text>
					) : null}
				</View>
			))}
			{lines && lines.stays.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("stays", {
						places: list(lines.stays.map((id) => name(id, true))),
					})}
				</Text>
			) : null}
			{lines && lines.unknown.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("unknown", {
						places: list(lines.unknown.map((id) => name(id, true))),
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
