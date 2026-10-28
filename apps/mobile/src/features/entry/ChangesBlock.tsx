import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import {
	type ChangeLines,
	changeLines,
	type PreviewState,
	type ShareLine,
	sharesOf,
} from "./preview";

type Money = { minor: number; currency: string };

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
}: {
	state: PreviewState;
	/** What to say before there is anything to preview. */
	idle: string;
}) {
	const t = useTranslations("mobile.composer.changes");
	const tl = useTranslations("mobile.composer.list");
	const tm = useTranslations("mobile.money");
	const { color, space, type } = useTheme();
	const { format } = useFormatMoney();
	const lines: ChangeLines | null =
		state.status === "ready" ? changeLines(state.diff) : null;
	const shares: ShareLine[] | null =
		state.status === "ready" ? sharesOf(state.diff) : null;
	// One precision down a column: every amount shows its minor digits.
	const money = (value: Money, sign?: "exceptZero") =>
		format(value, { cents: true, sign }) ?? "";
	const marked = (text: string, approx: boolean) =>
		approx ? tm("approx", { amount: text }) : text;

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
							{marked(money(line.delta, "exceptZero"), line.approx)}
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
							{t("to", { amount: marked(money(line.after), line.approx) })}
						</Text>
					) : null}
				</View>
			))}
			{shares && shares.length > 0 ? (
				<View style={{ gap: space[2], paddingTop: space[2] }}>
					<Text
						style={{
							color: color.fg,
							fontSize: type.body.size,
							fontWeight: "600",
						}}
					>
						{t("shares.title")}
					</Text>
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
							<Text
								numberOfLines={1}
								style={{
									flexShrink: 1,
									color: color.fg,
									fontSize: type.body.size,
								}}
							>
								{s.you ? t("shares.you") : s.name}
							</Text>
							<Text
								style={{
									color: color.fg,
									fontSize: type.body.size,
									fontVariant: ["tabular-nums"],
									textAlign: "right",
								}}
							>
								{shareText(s)}
							</Text>
						</View>
					))}
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("shares.told")}
					</Text>
				</View>
			) : null}
			{lines && lines.stays.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("stays", {
						places: list(lines.stays.map((id) => name(id, true))),
					})}
				</Text>
			) : null}
			{shares && shares.length === 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("shares.same")}
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
