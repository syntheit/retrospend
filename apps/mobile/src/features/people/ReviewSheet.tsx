import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { PreviewList } from "@/features/settle/PreviewList";
import { previewRows } from "@/features/settle/plan";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import type { LedgerRow } from "./PersonSections";
import type { NeedsItem, PersonIdentity } from "./source";
import { type ReviewChoice, useReview } from "./useReview";

export type ReviewNeed = Extract<NeedsItem, { kind: "verify" }>;

/**
 * Answering a split somebody added you to: what it is and your share, then
 * Accept, Reject or Ask to fix. Each choice shows the server's dry run of
 * that very write (what changes and what stays) before it is saved, and ends
 * with a toast that takes it back (R30, R15).
 */
export function ReviewSheet({
	person,
	need,
	row,
	visible,
	onClose,
	onDone,
}: {
	person: PersonIdentity;
	need: ReviewNeed;
	/** The ledger row of this expense, when the page carries it. */
	row: LedgerRow | undefined;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.review");
	const tc = useTranslations("mobile.common");
	const toast = useToast();
	const money = useMoneyText();
	const { color, radius, size, space, type } = useTheme();
	const [choice, setChoice] = useState<ReviewChoice>("accept");
	const [message, setMessage] = useState("");
	const flow = useReview(need.id, choice, message, visible);
	const first = person.name.split(/\s+/)[0] ?? person.name;

	// Each opening starts on Accept with no message.
	useEffect(() => {
		if (!visible) return;
		setChoice("accept");
		setMessage("");
	}, [visible]);

	async function save() {
		const done = await flow.send();
		if (!done) return;
		onClose();
		onDone();
		toast.show({
			message:
				choice === "accept"
					? t("accepted")
					: choice === "reject"
						? t("rejected", { name: first })
						: t("asked", { name: first }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const undone = await flow.undo(done.undoToken);
					toast.show({ message: undone ? t("undone") : t("undoError") });
					if (undone) onDone();
				},
			},
		});
	}

	// What it does between you, when that is not just your share said twice.
	const effect =
		row?.effect &&
		(Math.abs(row.effect.minor) !== need.amount.minor ||
			row.effect.currency !== need.amount.currency)
			? row.effect.minor > 0
				? t("effectThem", {
						amount: money({
							minor: row.effect.minor,
							currency: row.effect.currency,
						}),
					})
				: t("effectYou", {
						amount: money({
							minor: Math.abs(row.effect.minor),
							currency: row.effect.currency,
						}),
					})
			: null;

	const line = (label: string, value: string) => (
		<View
			accessibilityLabel={`${label}, ${value}`}
			accessible
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: space[3],
			}}
		>
			<Text style={{ color: color.fg2, fontSize: type.body.size }}>
				{label}
			</Text>
			<Text
				style={{
					flexShrink: 1,
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</View>
	);

	const note = (text: string, tone: "plain" | "attention" = "plain") => (
		<Text
			style={{
				color: tone === "attention" ? color.attentionText : color.fg2,
				fontSize: type.body.size,
			}}
		>
			{text}
		</Text>
	);

	const rows = flow.preview ? previewRows(flow.preview) : null;
	const saveLabel =
		choice === "accept"
			? t("accept")
			: choice === "reject"
				? t("reject")
				: t("askToFix");

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title", { name: first })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				<Text
					style={{
						color: color.fg,
						fontSize: type.title.size,
						fontWeight: "600",
					}}
				>
					{need.title}
				</Text>
				<View style={{ gap: space[2] }}>
					{line(t("yourShare"), money(need.amount))}
					{effect ? line(t("betweenYou"), effect) : null}
				</View>
				<Segmented
					accessibilityLabel={t("answer")}
					onChange={setChoice}
					options={[
						{ value: "accept", label: t("accept") },
						{ value: "reject", label: t("reject") },
						{ value: "fix", label: t("askToFix") },
					]}
					value={choice}
				/>
				{note(t(`explain.${choice}`, { name: first }))}
				{choice === "fix" ? (
					<View style={{ gap: space[2] }}>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{t("message")}
						</Text>
						<TextInput
							accessibilityLabel={t("message")}
							multiline
							onChangeText={setMessage}
							style={{
								minHeight: size.moneyInput.phone,
								paddingHorizontal: space[3],
								paddingVertical: space[2],
								borderRadius: radius.ctl,
								borderWidth: 1,
								borderColor: color.lineStrong,
								backgroundColor: color.surface,
								color: color.fg,
								fontSize: type.body.size,
							}}
							value={message}
						/>
					</View>
				) : null}
				{flow.preview ? (
					rows && rows.changes.length + rows.kept.length > 0 ? (
						<PreviewList name={first} preview={flow.preview} />
					) : (
						note(t("noFigures"))
					)
				) : flow.previewFailed ? (
					note(t("previewError"), "attention")
				) : (
					note(t("checking"))
				)}
				{flow.failed ? note(t("error"), "attention") : null}
				<Button
					disabled={!flow.preview || flow.busy}
					label={flow.busy ? t("saving") : saveLabel}
					onPress={save}
				/>
			</ScrollView>
		</Sheet>
	);
}
