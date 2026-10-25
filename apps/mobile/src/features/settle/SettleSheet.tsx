import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import type { PersonIdentity } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import { PreviewList } from "./PreviewList";
import { allocationOf } from "./plan";
import { useSettle } from "./useSettle";

const EVERYTHING = "everything";

/**
 * Settle up in three taps from People: the person, Settle up, Record
 * payment. The sheet opens on the way the server suggests with Everything,
 * shows what the payment changes and what it does not (the server's dry run
 * of the real write), and ends with a toast that undoes it (R15, R30).
 */
export function SettleSheet({
	person,
	visible,
	onClose,
	onDone,
}: {
	person: PersonIdentity;
	visible: boolean;
	onClose: () => void;
	/** The payment went through (or was undone): the page behind refreshes. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.settle");
	const tc = useTranslations("mobile.common");
	const tm = useTranslations("mobile.money");
	const toast = useToast();
	const format = useMoneyText();
	const { color, space, type } = useTheme();
	const flow = useSettle({ type: person.type, id: person.id }, visible);
	const name = person.name;
	const first = name.split(/\s+/)[0] ?? name;
	const { context } = flow;
	const allocation = flow.preview ? allocationOf(flow.preview) : null;
	const nothingOwed = context !== null && context.parts.length === 0;

	async function record() {
		const result = await flow.record();
		if (!result) return;
		onClose();
		onDone();
		toast.show({
			message:
				result.status === "PROPOSED"
					? t("recordedWaiting", { name: first })
					: t("recorded"),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const undone = await flow.undo(result.undoToken);
					toast.show({ message: undone ? t("undone") : t("undoError") });
					if (undone) onDone();
				},
			},
		});
	}

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

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("with", { name })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				{flow.status === "loadError" ? (
					<>
						{note(t("loadError"), "attention")}
						<Button
							label={tc("retry")}
							onPress={flow.retryLoad}
							variant="outlined"
						/>
					</>
				) : context && flow.direction ? (
					<>
						<Segmented
							accessibilityLabel={t("direction")}
							onChange={(value) => flow.changeDirection(value)}
							options={[
								{ value: "outgoing", label: t("iPaid", { name: first }) },
								{ value: "incoming", label: t("theyPaid", { name: first }) },
							]}
							value={flow.direction}
						/>
						{nothingOwed ? note(t("nothingOwed")) : null}
						{context.parts.length > 1 ? (
							<Segmented
								accessibilityLabel={t("amount")}
								onChange={(value) =>
									flow.setChoice(
										value === EVERYTHING
											? { kind: "everything" }
											: { kind: "part", currency: value },
									)
								}
								options={[
									{ value: EVERYTHING, label: t("everythingShort") },
									...context.parts.map((p) => ({
										value: p.currency,
										label: t("partShort", { currency: p.currency }),
									})),
								]}
								value={
									flow.choice.kind === "part"
										? flow.choice.currency
										: EVERYTHING
								}
							/>
						) : null}
						{context.unpriced.length > 0
							? note(
									t("unpriced", { currencies: context.unpriced.join(", ") }),
									"attention",
								)
							: null}
						{allocation ? (
							<View style={{ gap: space[1] }}>
								<Text style={{ color: color.fg2, fontSize: type.small.size }}>
									{t("amount")}
								</Text>
								<Text
									style={{
										color: color.fg,
										fontSize: type.title.size,
										fontVariant: ["tabular-nums"],
										fontWeight: "600",
									}}
								>
									{allocation.converted
										? tm("approx", { amount: format(allocation.amount) })
										: format(allocation.amount)}
								</Text>
							</View>
						) : null}
						{flow.preview ? (
							<PreviewList name={first} preview={flow.preview} />
						) : flow.previewFailed ? (
							note(t("previewError"), "attention")
						) : nothingOwed ? null : (
							note(t("checking"))
						)}
						{flow.recordFailed ? note(t("error"), "attention") : null}
						<Button
							disabled={!flow.preview || flow.recording}
							label={flow.recording ? t("recording") : t("record")}
							onPress={record}
						/>
					</>
				) : (
					note(t("checking"))
				)}
			</ScrollView>
		</Sheet>
	);
}
