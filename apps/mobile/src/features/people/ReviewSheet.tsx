import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { PreviewList } from "@/features/settle/PreviewList";
import { previewRows } from "@/features/settle/plan";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
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
	const { space } = useTheme();
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
			<Text tone="fg2">{label}</Text>
			<Text style={{ flexShrink: 1, textAlign: "right" }} tabular>
				{value}
			</Text>
		</View>
	);

	const note = (text: string, tone: "plain" | "attention" = "plain") => (
		<Text tone={tone === "attention" ? "attention" : "fg2"}>{text}</Text>
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
			footer={
				<Button
					disabled={!flow.preview || flow.busy}
					label={flow.busy ? t("saving") : saveLabel}
					onPress={save}
				/>
			}
			onClose={onClose}
			title={t("title", { name: first })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				<Text variant="title">{need.title}</Text>
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
					stretch
					value={choice}
				/>
				{note(t(`explain.${choice}`, { name: first }))}
				{choice === "fix" ? (
					<TextField
						label={t("message")}
						multiline
						onChangeText={setMessage}
						value={message}
					/>
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
			</ScrollView>
		</Sheet>
	);
}
