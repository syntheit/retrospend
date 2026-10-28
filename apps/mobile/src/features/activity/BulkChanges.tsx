import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { ChangesBlock } from "@/features/entry/ChangesBlock";
import { changeLines, type PreviewState } from "@/features/entry/preview";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";

/**
 * What a delete of several expenses changes. The server answered one delete
 * at a time, so every moved figure is a sum of those answers and reads with
 * the approximate mark. One expense, or any state that is not an answer yet,
 * is the plain changes block.
 */
export function BulkChanges({
	state,
	summed,
}: {
	state: PreviewState;
	/** More than one expense was previewed on its own and added up. */
	summed: boolean;
}) {
	const t = useTranslations("mobile.composer.changes");
	const tm = useTranslations("mobile.money");
	const tl = useTranslations("mobile.composer.list");
	const { color, space, type } = useTheme();
	const { format } = useFormatMoney();
	if (state.status !== "ready" || !summed) {
		return <ChangesBlock idle="" state={state} />;
	}
	const lines = changeLines(state.diff);
	const name = (id: string, inline: boolean) => {
		const group = inline ? "figuresInline" : "figures";
		const key = `${group}.${id.replaceAll(".", "_")}`;
		// The key is built at run time, so it can not be checked against the catalog.
		return t.has(key as never) ? t(key as never) : t(`${group}.other` as never);
	};
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
			{lines.moved.map((line) => (
				<View
					key={line.key}
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
						{tm("approx", {
							amount:
								format(line.delta, { cents: true, sign: "exceptZero" }) ?? "",
						})}
					</Text>
				</View>
			))}
			{lines.stays.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("stays", {
						places: list(lines.stays.map((id) => name(id, true))),
					})}
				</Text>
			) : null}
			{lines.unknown.length > 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("unknown", {
						places: list(lines.unknown.map((id) => name(id, true))),
					})}
				</Text>
			) : null}
			{lines.moved.length === 0 ? (
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{t("nothing")}
				</Text>
			) : null}
		</View>
	);
}
