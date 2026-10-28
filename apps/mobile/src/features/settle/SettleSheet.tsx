import { parseMoneyInput } from "@retrospend/domain/parse";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import type { PersonIdentity } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { Picker } from "@/ui/Picker";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import { PreviewList } from "./PreviewList";
import { allocationOf } from "./plan";
import { useSettle } from "./useSettle";

const EVERYTHING = "everything";
/** Segments past this many do not fit a phone's width (Everything, two parts, Other): a menu takes over. */
const MAX_SEGMENTS = 3;

function AmountControl({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: { value: string; label: string }[];
	value: string;
	onChange: (value: string) => void;
}) {
	return options.length > MAX_SEGMENTS ? (
		<Picker onChange={onChange} options={options} value={value} />
	) : (
		<Segmented
			accessibilityLabel={label}
			onChange={onChange}
			options={options}
			value={value}
		/>
	);
}
const CUSTOM = "custom";

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
	const { color, size, space, type } = useTheme();
	const locale = useMoneyLocale();
	const flow = useSettle({ type: person.type, id: person.id }, visible);
	const name = person.name;
	const first = name.split(/\s+/)[0] ?? name;
	const { context } = flow;
	const allocation = flow.preview ? allocationOf(flow.preview) : null;
	const nothingOwed = context !== null && context.parts.length === 0;
	// The typed amount, as the keypad shows it; 0 until it reads as money.
	const [draft, setDraft] = useState("");
	const amountMinor =
		context && draft !== ""
			? (() => {
					const read = parseMoneyInput(draft, locale, context.currency);
					return read.ok ? read.minor : 0;
				})()
			: 0;
	const custom = flow.choice.kind === "custom";
	// A new opening, or any other amount choice, starts the keypad empty.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` and `custom` are the triggers
	useEffect(() => {
		if (!custom) setDraft("");
	}, [visible, custom]);

	function changeDraft(next: string) {
		setDraft(next);
		if (!context) return;
		const read = parseMoneyInput(next, locale, context.currency);
		flow.setChoice({ kind: "custom", minor: read.ok ? read.minor : 0 });
	}

	function pickCustom() {
		setDraft("");
		flow.setChoice({ kind: "custom", minor: 0 });
	}

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
						{nothingOwed ? null : (
							<AmountControl
								label={t("amount")}
								onChange={(value) => {
									if (value === CUSTOM) pickCustom();
									else
										flow.setChoice(
											value === EVERYTHING
												? { kind: "everything" }
												: { kind: "part", currency: value },
										);
								}}
								options={[
									{ value: EVERYTHING, label: t("everythingShort") },
									...(context.parts.length > 1
										? context.parts.map((p) => ({
												value: p.currency,
												label: t("partShort", { currency: p.currency }),
											}))
										: []),
									{ value: CUSTOM, label: t("otherShort") },
								]}
								value={
									flow.choice.kind === "part"
										? flow.choice.currency
										: flow.choice.kind === "custom"
											? CUSTOM
											: EVERYTHING
								}
							/>
						)}
						{flow.choice.kind === "custom" ? (
							<>
								<Text
									accessibilityLabel={
										amountMinor > 0
											? `${t("amount")}, ${format({ minor: amountMinor, currency: context.currency })}`
											: t("typeAmount")
									}
									style={{
										color: amountMinor > 0 ? color.fg : color.fg3,
										fontSize: type.title.size,
										fontVariant: ["tabular-nums"],
										fontWeight: "600",
									}}
								>
									{draft === ""
										? context.currency
										: `${context.currency} ${draft}`}
								</Text>
								<MoneyKeypad
									currency={context.currency}
									draft={draft}
									keyHeight={size.touchMin.phone}
									onDraftChange={changeDraft}
								/>
								{draft !== "" && amountMinor === 0 ? (
									<Text
										style={{
											color: color.attentionText,
											fontSize: type.body.size,
										}}
									>
										{t("amountInvalid")}
									</Text>
								) : null}
							</>
						) : null}
						{context.unpriced.length > 0
							? note(
									t("unpriced", { currencies: context.unpriced.join(", ") }),
									"attention",
								)
							: null}
						{allocation && !custom ? (
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
						) : flow.overpaid ? (
							note(t("overpay"), "attention")
						) : flow.previewFailed ? (
							note(t("previewError"), "attention")
						) : nothingOwed || (custom && amountMinor === 0) ? null : (
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
