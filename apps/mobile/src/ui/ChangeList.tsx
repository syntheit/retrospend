import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "./Text";
import { TextAction } from "./TextAction";

/** A label on the left and a figure on the right, right-aligned with tabular figures. */
export function Line({
	label,
	value,
	detail,
	spoken,
	emphasis,
}: {
	label: string;
	value: string;
	/** A smaller line under the figure ("to $120"). */
	detail?: string;
	/** What a screen reader says when the pair reads better as a sentence. */
	spoken?: string;
	emphasis?: boolean;
}) {
	const { space } = useTheme();
	return (
		<View
			accessibilityLabel={
				spoken ?? [label, value, detail].filter(Boolean).join(", ")
			}
			accessible
			style={{ paddingVertical: space[1] }}
		>
			<View
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<Text style={{ flexShrink: 1 }} tone="fg2">
					{label}
				</Text>
				<Text
					style={{ textAlign: "right" }}
					tabular
					weight={emphasis ? "semibold" : "normal"}
				>
					{value}
				</Text>
			</View>
			{detail ? (
				<Text style={{ textAlign: "right" }} tabular tone="fg2" variant="small">
					{detail}
				</Text>
			) : null}
		</View>
	);
}

/** One place that moves: its name, and what happens to it. */
export interface ChangeRow {
	key: string;
	label: string;
	value: string;
	detail?: string;
	spoken?: string;
}

/** Rows the write states under their own heading (whose share moves). */
export interface ChangeGroup {
	key: string;
	/** Omitted for a sentence with no rows. */
	title?: string;
	rows: ChangeRow[];
	note?: string;
}

/** The dry run's state: nothing to check yet, asking, answered, or no answer. */
export type ChangeStatus = "idle" | "loading" | "ready" | "failed" | "refused";

/**
 * What this changes (R30), the one block before Save and the one wording of
 * it, the native twin of the web's SheetChanges: a hairline and the heading,
 * one line per place that moves, then one sentence for what was checked and
 * stays, and one for what could not be checked. The figures are the server's
 * dry run of the same write Save makes; the block only lays them out. It says
 * "Checking" until the dry run is in, so Save never runs ahead of it, and a
 * `message` stands in for the lines when there is a reason to give (offline,
 * a missing rate). Each API shape feeds it through an adapter (PreviewChanges,
 * BudgetChanges, ChangesBlock, PreviewList); none of them lays out its own.
 */
export function ChangeList({
	status,
	changes = [],
	groups = [],
	holds = [],
	stays = [],
	unavailable = [],
	message,
	onRetry,
}: {
	status: ChangeStatus;
	/** The figures that moved. */
	changes?: ChangeRow[];
	groups?: ChangeGroup[];
	/** Figures checked that do not move, with their amounts (a settlement shows them). */
	holds?: ChangeRow[];
	/** Names of the figures checked that stay as they are. */
	stays?: string[];
	/** Names of the figures that could not be checked. */
	unavailable?: string[];
	/** Shown instead of the lines: a reason, or what to do first. */
	message?: string;
	/** Asks the server again after an answer that did not come or was refused. */
	onRetry?: () => void;
}) {
	const t = useTranslations("mobile.changes");
	const tc = useTranslations("mobile.common");
	const { color, space } = useTheme();
	const attention = status === "failed" || status === "refused";
	let words = message;
	if (!words) {
		if (status === "loading") words = t("checking");
		else if (status === "failed") words = t("error");
		else if (status === "refused") words = t("refused");
	}
	if (status === "idle" && !words) return null;

	const frame = (children: ReactNode) => (
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
			{children}
		</View>
	);

	if (words) {
		return frame(
			<>
				<Text
					accessibilityRole={attention ? "alert" : undefined}
					tone={attention ? "attention" : "fg2"}
				>
					{words}
				</Text>
				{onRetry && status !== "loading" ? (
					<View style={{ alignItems: "flex-start" }}>
						<TextAction label={tc("retry")} onPress={onRetry} />
					</View>
				) : null}
			</>,
		);
	}

	// One name per place, even when it moves in two currencies.
	const kept = [...new Set(stays)];
	const missing = [...new Set(unavailable)];
	const anyLine = changes.length > 0 || groups.some((g) => g.rows.length > 0);
	const keeps =
		kept.length === 0
			? null
			: !anyLine
				? t("noneChange", { list: kept.join(", ") })
				: kept.length === 1
					? t("nothingElseOne", { item: kept[0] ?? "" })
					: t("nothingElse", { list: kept.join(", ") });
	const closing = [
		keeps,
		missing.length > 0 ? t("unavailable", { list: missing.join(", ") }) : null,
	]
		.filter(Boolean)
		.join(" ");
	const shown = anyLine || groups.length > 0 || holds.length > 0;
	return frame(
		<>
			{changes.map((row) => (
				<Line
					detail={row.detail}
					key={row.key}
					label={row.label}
					spoken={row.spoken}
					value={row.value}
				/>
			))}
			{groups.map((group) => (
				<View key={group.key} style={{ gap: space[1], paddingTop: space[2] }}>
					{group.title ? (
						<Text accessibilityRole="header" weight="semibold">
							{group.title}
						</Text>
					) : null}
					{group.rows.map((row) => (
						<Line
							detail={row.detail}
							key={row.key}
							label={row.label}
							spoken={row.spoken}
							value={row.value}
						/>
					))}
					{group.note ? (
						<Text tone="fg2" variant="small">
							{group.note}
						</Text>
					) : null}
				</View>
			))}
			{holds.length > 0 ? (
				<View style={{ gap: space[1], paddingTop: space[2] }}>
					<Text accessibilityRole="header" tone="fg2" weight="semibold">
						{t("stays")}
					</Text>
					{holds.map((row) => (
						<Line
							key={row.key}
							label={row.label}
							spoken={row.spoken}
							value={row.value}
						/>
					))}
				</View>
			) : null}
			{!shown && !keeps ? <Text tone="fg2">{t("nothing")}</Text> : null}
			{closing ? (
				<Text tone="fg3" variant="meta">
					{closing}
				</Text>
			) : null}
		</>,
	);
}
