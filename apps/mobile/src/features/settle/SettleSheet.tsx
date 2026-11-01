import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import type { PersonIdentity } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { readAmount } from "@/features/write/amount";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useRateFormat } from "@/lib/rateFormat";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { FixedCurrency } from "@/ui/AmountField";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import type { MoneyLine } from "../entry/AmountCard";
import { AmountEntry } from "../entry/AmountEntry";
import { ComposerFrame } from "../entry/ComposerFrame";
import { SheetHead } from "../entry/SheetHead";
import { useLocalPad } from "../entry/useLocalPad";
import { useDayWords, WhenPanel } from "../entry/WhenPanel";
import { AfterThis, OverpayAction } from "./AfterThis";
import { AmountChoices } from "./AmountChoices";
import { PreviewList } from "./PreviewList";
import {
	allocationDetail,
	type Direction,
	everythingConverts,
	fillOf,
	type RateChoices,
	rateChoices,
} from "./plan";
import { MethodChips, RateChips, useMethodName } from "./SettleDetails";
import { SettleHead } from "./SettleHead";
import { useSettle } from "./useSettle";

/**
 * Settle up in three taps from People: the person, Settle up, Record
 * payment. The composer's frame, lighter: the amount is already filled with
 * what the server suggests and the keypad is folded, so what the payment
 * changes (the server's dry run of the real write) is the first thing under
 * it, and Record sits in the keypad's place. The panels are Method, When and
 * Rate (only when something converts). It ends with a toast that undoes the
 * payment (R15, R30).
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
	const size = useSheetBodySize();
	return (
		<Sheet
			detents={["large"]}
			dismiss="none"
			grouped
			onClose={onClose}
			visible={visible}
		>
			<View style={size}>
				{visible ? (
					<SettleComposer onClose={onClose} onDone={onDone} person={person} />
				) : null}
			</View>
		</Sheet>
	);
}

type PanelName = "method" | "when" | "rate";

/** Who paid: the direction, at the head of the composer. */
function SettleDirection({
	direction,
	first,
	onChange,
}: {
	direction: Direction;
	first: string;
	onChange: (direction: Direction) => void;
}) {
	const t = useTranslations("mobile.settle");
	return (
		<Segmented
			accessibilityLabel={t("direction")}
			onChange={onChange}
			options={[
				{ value: "outgoing", label: t("iPaid", { name: first }) },
				{ value: "incoming", label: t("theyPaid", { name: first }) },
			]}
			stretch
			value={direction}
		/>
	);
}

function SettleComposer({
	person,
	onClose,
	onDone,
}: {
	person: PersonIdentity;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.settle");
	const tc = useTranslations("mobile.common");
	const tx = useTranslations("mobile.composer");
	const toast = useToast();
	const format = useMoneyText();
	const { format: formatMoney } = useFormatMoney();
	const { space } = useTheme();
	const locale = useMoneyLocale();
	const day = useDayWords();
	const rateName = useRateTypeName();
	const rateFmt = useRateFormat();
	const flow = useSettle({ type: person.type, id: person.id }, true);
	const methodName = useMethodName(flow.shared);
	const first = person.name.split(/\s+/)[0] ?? person.name;
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
	// A chip fills the amount with the server's own figure; typing makes the
	// amount the typed one and unpicks the chips.
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
	// It opens on the server's suggestion, already filled, with the keys put
	// away. Tapping the amount brings them up; any pick puts them away again.
	const pad = useLocalPad({ open: false, hasAmount: amountMinor > 0 });

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
	const head = (
		<SheetHead onCancel={onClose} title={t("with", { name: first })} />
	);
	const stateView = (children: React.ReactNode) => (
		<View style={{ flex: 1, padding: space[4], gap: space[4] }}>
			{head}
			{children}
		</View>
	);

	if (flow.status === "loadError") {
		return stateView(
			<>
				{note(t("loadError"), "attention")}
				<Button
					label={tc("retry")}
					onPress={flow.retryLoad}
					variant="outlined"
				/>
			</>,
		);
	}
	if (!context || !flow.direction) return stateView(note(t("checking")));
	if (nothingOwed) return stateView(note(t("nothingOwed")));
	const direction = flow.direction;

	const names: PanelName[] = shownRates
		? ["method", "when", "rate"]
		: ["method", "when"];
	const at = (name: PanelName) => names.indexOf(name);
	const paidOn = flow.paidOn ?? context.today;
	const methodWords = flow.method ? methodName(flow.method) : t("methodNone");

	const parts = [
		{ key: "method", text: methodWords, page: at("method") },
		{ key: "when", text: day.short(paidOn), page: at("when") },
		...(shownRates?.current
			? [
					{
						key: "rate",
						// A type carries its number (R8).
						text:
							(shownRates.rates[0]
								? rateFmt.withType(
										rateName(shownRates.current),
										shownRates.rates[0],
									)
								: null) ?? rateName(shownRates.current),
						page: at("rate"),
					},
				]
			: []),
	].map((part) => ({
		key: part.key,
		text: part.text,
		active: pad.page === part.page,
		onPress: () => pad.goTo(part.page),
	}));

	const tabs = names.map((name) => ({
		key: name,
		label:
			name === "method"
				? t("method")
				: name === "when"
					? tx("tabs.when")
					: t("rateTab"),
		icon: (name === "method"
			? "CreditCard"
			: name === "when"
				? "Calendar"
				: "Coins") as "CreditCard",
		dot:
			name === "method"
				? flow.method !== null
				: name === "when"
					? flow.paidOn !== null && flow.paidOn !== context.today
					: false,
	}));

	const panelOf: Record<PanelName, React.ReactNode> = {
		method: (
			<MethodChips
				key="method"
				method={flow.method}
				onMethod={(next) => {
					pad.fold();
					flow.setMethod(next);
				}}
				shared={flow.shared}
			/>
		),
		when: (
			<WhenPanel
				date={paidOn}
				key="when"
				onPick={(next) => {
					pad.fold();
					flow.setPaidOn(next);
				}}
			/>
		),
		rate: shownRates ? (
			<RateChips
				choices={shownRates}
				key="rate"
				onPick={(type) => {
					pad.fold();
					flow.changeRate(type);
				}}
				values={flow.typeRates}
			/>
		) : null,
	};

	const line: MoneyLine = {
		key: "amount",
		currency: <FixedCurrency code={context.currency} />,
		text: draft,
		placeholder: "0",
		spoken:
			amountMinor > 0
				? tx("amountLabel", {
						amount:
							formatMoney({ minor: amountMinor, currency: context.currency }) ??
							"",
					})
				: tx("amountEmpty", { currency: context.currency }),
		active: true,
		onPress: pad.requestKeypad,
	};

	const recordLabel = allocation
		? t("recordAmount", { amount: format(allocation.amount) })
		: t("record");

	return (
		<ComposerFrame
			add={{
				onPress: () => void record(),
				label: t("recordKey"),
				description: t("record"),
				folded: flow.recording ? t("recording") : recordLabel,
				off: !flow.preview || flow.recording,
				busy: flow.recording,
			}}
			amount={
				<AmountEntry
					currency={context.currency}
					error={false}
					line={line}
					onFocusChange={pad.setTyping}
					onPress={pad.requestKeypad}
					onText={changeDraft}
					padOpen={pad.padOpen}
					system={pad.system}
					text={draft}
					typing={pad.typing}
				/>
			}
			changedLabel={tx("tabs.changed")}
			header={
				<View style={{ gap: space[2] }}>
					{head}
					<SettleDirection
						direction={direction}
						first={first}
						onChange={(next) => {
							pad.fold();
							flow.changeDirection(next);
						}}
					/>
				</View>
			}
			keypad={{
				text: draft,
				currency: context.currency,
				kind: "money",
				onChange: changeDraft,
			}}
			keypadOpen={pad.padOpen}
			onPageChange={(next) => pad.goTo(next)}
			onScrollDrag={() => {
				if (pad.system) pad.setPadOpen(false);
			}}
			page={pad.page}
			panels={names.map((name) => panelOf[name])}
			preview={
				<View style={{ gap: space[3] }}>
					{flow.preview ? (
						<PreviewList name={first} preview={flow.preview} />
					) : null}
					{context.unpriced.length > 0
						? note(
								t("unpriced", { currencies: context.unpriced.join(", ") }),
								"attention",
							)
						: null}
					{!flow.preview && flow.overpaid ? (
						<OverpayAction
							converts={everythingConverts(context, direction)}
							direction={direction}
							name={first}
							onExact={() => flow.setChoice({ kind: "everything" })}
							overpaid={flow.overpaidBy}
						/>
					) : !flow.preview && flow.previewFailed ? (
						note(t("previewError"), "attention")
					) : !flow.preview && !(custom && amountMinor === 0) ? (
						note(t("checking"))
					) : null}
					{flow.recordFailed ? note(t("error"), "attention") : null}
				</View>
			}
			summary={parts}
			surface
			tabs={tabs}
			tabsLabel={tx("tabs.label")}
			title={
				<View style={{ gap: space[3] }}>
					<SettleHead
						context={context}
						direction={direction}
						hideSwitch
						onDirection={() => {}}
						person={person}
					/>
					<AmountChoices
						choice={flow.choice}
						context={context}
						direction={direction}
						onChoose={(next) => {
							pad.fold();
							flow.setChoice(next);
						}}
					/>
					{flow.preview ? (
						<AfterThis
							direction={direction}
							name={first}
							onRetrospend={person.onRetrospend}
							preview={flow.preview}
						/>
					) : null}
				</View>
			}
			typing={pad.typing}
		/>
	);
}
