import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import type { PersonIdentity } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { readAmount } from "@/features/write/amount";
import { AmountField } from "@/features/write/parts";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { AfterThis, OverpayAction } from "./AfterThis";
import { AmountChoices } from "./AmountChoices";
import { PreviewList } from "./PreviewList";
import {
	allocationDetail,
	everythingConverts,
	fillOf,
	type RateChoices,
	rateChoices,
} from "./plan";
import { MethodAndDate, RateChips } from "./SettleDetails";
import { SettleHead } from "./SettleHead";
import { useSettle } from "./useSettle";

/**
 * Settle up in three taps from People: the person, Settle up, Record
 * payment. The sheet opens on the way the server suggests with Everything,
 * shows what the payment changes and what it does not (the server's dry run
 * of the real write), and ends with a toast that undoes it (R15, R30).
 * The faces head, the amount chips, the rate type of a conversion, the
 * method and the day are the page's settle.html; Record stays pinned.
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
	const toast = useToast();
	const format = useMoneyText();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const locale = useMoneyLocale();
	const flow = useSettle({ type: person.type, id: person.id }, visible);
	const name = person.name;
	const first = name.split(/\s+/)[0] ?? name;
	const { context } = flow;
	const allocation = flow.preview ? allocationDetail(flow.preview) : null;
	const nothingOwed = context !== null && context.everything === null;
	// The rate chips follow the dry run; while a new rate type is read in, they
	// stay with the new type picked instead of flickering out.
	const rates = context
		? rateChoices(context, allocation, flow.rateType)
		: null;
	const keptRates = useRef<RateChoices | null>(null);
	if (flow.preview) keptRates.current = rates;
	const shownRates =
		rates ??
		(flow.repricing && keptRates.current
			? { ...keptRates.current, current: flow.rateType }
			: null);
	// The amount field is always there. A chip fills it with the server's own
	// amount; typing makes the amount the typed one and unpicks the chips.
	const [typed, setTyped] = useState("");
	const custom = flow.choice.kind === "custom";
	const fill = context ? fillOf(context, flow.choice) : null;
	const draft = custom
		? typed
		: fill
			? draftFromMinor(fill.minor, locale, fill.currency)
			: "";
	const entered = readAmount(draft, locale, context?.currency ?? "");
	const amountMinor = entered.state === "ok" ? entered.minor : 0;
	// A new opening starts the field on what the server suggests.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the trigger
	useEffect(() => {
		setTyped("");
	}, [visible]);

	function changeDraft(next: string) {
		setTyped(next);
		if (!context) return;
		const read = parseMoneyInput(next, locale, context.currency);
		flow.setChoice({ kind: "custom", minor: read.ok ? read.minor : 0 });
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
		<Text tone={tone === "attention" ? "attention" : "fg2"}>{text}</Text>
	);

	const ready = context !== null && flow.direction !== null && !nothingOwed;
	const footer = ready ? (
		<>
			<Button label={tc("cancel")} onPress={onClose} variant="outlined" />
			<Button
				disabled={!flow.preview || flow.recording}
				label={
					flow.recording
						? t("recording")
						: allocation
							? t("recordAmount", { amount: format(allocation.amount) })
							: t("record")
				}
				onPress={record}
			/>
		</>
	) : undefined;

	return (
		<Sheet
			detents={["large"]}
			footer={footer}
			onClose={onClose}
			title={t("with", { name: first })}
			visible={visible}
		>
			<View style={{ ...body }}>
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
							<SettleHead
								context={context}
								direction={flow.direction}
								onDirection={flow.changeDirection}
								person={person}
							/>
							{nothingOwed ? note(t("nothingOwed")) : null}
							{nothingOwed ? null : (
								<View style={{ gap: space[1] }}>
									<FieldLabel>{t("amount")}</FieldLabel>
									<AmountField
										between={
											<AmountChoices
												choice={flow.choice}
												context={context}
												direction={flow.direction}
												onChoose={flow.setChoice}
											/>
										}
										currency={context.currency}
										draft={draft}
										entered={entered}
										label={t("amount")}
										onDraftChange={changeDraft}
									/>
								</View>
							)}
							{nothingOwed ? null : (
								<>
									{shownRates ? (
										<RateChips
											choices={shownRates}
											onPick={flow.changeRate}
											values={flow.typeRates}
										/>
									) : null}
									<MethodAndDate
										method={flow.method}
										onMethod={flow.setMethod}
										onPaidOn={flow.setPaidOn}
										paidOn={flow.paidOn}
										shared={flow.shared}
										today={context.today}
									/>
								</>
							)}
							{context.unpriced.length > 0
								? note(
										t("unpriced", { currencies: context.unpriced.join(", ") }),
										"attention",
									)
								: null}
							{flow.preview ? (
								<>
									<AfterThis
										direction={flow.direction}
										name={first}
										onRetrospend={person.onRetrospend}
										preview={flow.preview}
									/>
									<PreviewList name={first} preview={flow.preview} />
								</>
							) : flow.overpaid ? (
								<OverpayAction
									converts={everythingConverts(context, flow.direction)}
									direction={flow.direction}
									name={first}
									onExact={() => flow.setChoice({ kind: "everything" })}
									overpaid={flow.overpaidBy}
								/>
							) : flow.previewFailed ? (
								note(t("previewError"), "attention")
							) : nothingOwed || (custom && amountMinor === 0) ? null : (
								note(t("checking"))
							)}
							{flow.recordFailed ? note(t("error"), "attention") : null}
						</>
					) : (
						note(t("checking"))
					)}
				</ScrollView>
			</View>
		</Sheet>
	);
}
