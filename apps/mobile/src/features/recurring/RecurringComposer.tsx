import type { Money } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { MoneyLine } from "@/features/entry/AmountCard";
import { AmountEntry } from "@/features/entry/AmountEntry";
import { CategoryPanel } from "@/features/entry/CategoryPanel";
import { ComposerFrame } from "@/features/entry/ComposerFrame";
import { useCurrencyChoices } from "@/features/entry/currencyChoices";
import { useEntryCatalog } from "@/features/entry/hooks";
import { OptionRow } from "@/features/entry/MorePanel";
import { SheetHead } from "@/features/entry/SheetHead";
import type { EntryCatalog } from "@/features/entry/types";
import { useLocalPad } from "@/features/entry/useLocalPad";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import { type FigureDiff, figureLines } from "@/features/write/figures";
import { useAmountLocale } from "@/features/write/parts";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import {
	type PreviewStatus,
	useMoneyWrite,
	useWriteIds,
} from "@/features/write/useMoneyWrite";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { DateField } from "@/ui/DateField";
import { GlyphPill } from "@/ui/GlyphPill";
import { WheelField } from "@/ui/Picker";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useDayText } from "./ConfirmSheet";
import { nextMonthly, nextOnDay } from "./makeRecurring";
import { useRecurringToast } from "./useRecurringToast";

type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
type FrequencyKey = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const FREQUENCIES: { value: Frequency; key: FrequencyKey }[] = [
	{ value: "WEEKLY", key: "weekly" },
	{ value: "BIWEEKLY", key: "biweekly" },
	{ value: "MONTHLY", key: "monthly" },
	{ value: "QUARTERLY", key: "quarterly" },
	{ value: "YEARLY", key: "yearly" },
];

const DAYS_IN_MONTH = Array.from({ length: 31 }, (_, i) => String(i + 1));

type PanelName = "category" | "repeats" | "changes";
const NAMES: PanelName[] = ["category", "repeats", "changes"];

/**
 * The Add recurring sheet: the composer's one screen with a Repeats tab.
 * The amount (its currency picker is the one way to pick a currency), the
 * name as the title, the answers as a line, and the panels Category, Repeats
 * (how often, the day, Record automatically) and Changes. A template books
 * nothing until a confirm, so the server's dry run says what is added and
 * that every total stays; Add stays off until it is in. The write carries one
 * key per body, and the toast undoes it by deleting the template (R30, R15).
 */
export function RecurringComposer({
	catalog,
	onClose,
	onDone,
}: {
	catalog: EntryCatalog;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring");
	const tc = useTranslations("mobile.composer");
	const api = useApi();
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const announce = useRecurringToast();
	const day = useDayText();
	const locale = useAmountLocale();
	const { format } = useFormatMoney();
	const { space } = useTheme();
	const fallback = me?.defaultCurrency ?? me?.homeCurrency ?? "USD";
	const currencies = useCurrencyChoices(fallback);

	const [name, setName] = useState("");
	const [currency, setCurrency] = useState(fallback);
	const [text, setText] = useState("");
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
	const [first, setFirst] = useState(() => nextMonthly(dayKey(new Date())));
	const [anchor, setAnchor] = useState(() =>
		Number(nextMonthly(dayKey(new Date())).slice(8, 10)),
	);
	const [autoPay, setAutoPay] = useState(false);
	const [tried, setTried] = useState(false);

	const entered = readAmount(text, locale, currency);
	const minor = minorOf(entered);
	const title = name.trim();
	const pad = useLocalPad({ open: true, hasAmount: minor !== null });
	const input =
		title !== "" && minor !== null
			? {
					name: title,
					amount: wireAmount(minor, currency),
					currency,
					...(categoryId ? { categoryId } : {}),
					frequency,
					nextDueDate: first,
					...(frequency === "MONTHLY" ? { anchorDay: anchor } : {}),
					autoPay,
				}
			: null;
	const { idFor } = useWriteIds(input ? JSON.stringify(input) : null);
	const flow = useMoneyWrite({
		input,
		idempotencyKey: input ? idFor("write") : null,
		preview: (body) => (api ? api.recurring.previewCreate(body) : noSession()),
		write: (body, key) =>
			api
				? api.recurring.create(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		if (input === null) {
			setTried(true);
			return;
		}
		const made = await flow.commit();
		if (!made) return;
		announce({
			message: t("add.toast", { title: made.title }),
			undo: async () => {
				if (!api) throw new Error("Signed out");
				await api.recurring.delete(
					{ id: made.id },
					{ context: { idempotencyKey: newClientId() } },
				);
			},
			onChanged: onDone,
		});
		onClose();
	}

	// An expense template files under expense categories only; a cached list
	// from before kinds were sent is expense categories.
	const expenseCatalog: EntryCatalog = {
		...catalog,
		categories: catalog.categories.filter((c) => c.kind !== "income"),
	};
	const category = expenseCatalog.categories.find((c) => c.id === categoryId);

	const frequencyWord = t(`frequency.${keyOf(frequency)}`);
	const patch = (apply: () => void) => {
		apply();
		pad.fold();
	};
	const today = dayKey(new Date());
	const dayOfMonth = anchor;

	const parts = [
		{
			key: "category",
			text: category?.name ?? t("add.categoryNone"),
			page: 0,
		},
		{ key: "repeats", text: frequencyWord, page: 1 },
		{ key: "next", text: day(first), page: 1 },
		...(autoPay ? [{ key: "auto", text: t("item.autoPay"), page: 1 }] : []),
	].map((part) => ({
		key: part.key,
		text: part.text,
		active: pad.page === part.page,
		onPress: () => pad.goTo(part.page),
	}));

	const tabs = [
		{
			key: "category",
			label: tc("tabs.category"),
			icon: "Tag" as const,
			dot: categoryId !== null,
		},
		{
			key: "repeats",
			label: t("add.repeats"),
			icon: "Repeat" as const,
			dot: frequency !== "MONTHLY" || autoPay,
		},
		{
			key: "changes",
			label: t("add.changes"),
			icon: "ListChecks" as const,
		},
	];

	const panels = [
		<CategoryPanel
			catalog={expenseCatalog}
			draft={{ categoryId, editing: null }}
			error={false}
			key="category"
			onPick={(picked) => patch(() => setCategoryId(picked.id))}
		/>,
		<View key="repeats" style={{ gap: space[2] }}>
			<View
				accessibilityLabel={t("add.repeats")}
				style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
			>
				{FREQUENCIES.map((f) => (
					<GlyphPill
						glyph="Repeat"
						key={f.value}
						label={t(`frequency.${f.key}`)}
						onPress={() => patch(() => setFrequency(f.value))}
						selected={frequency === f.value}
					/>
				))}
			</View>
			{frequency === "MONTHLY" ? (
				<WheelField
					label={t("add.dayOfMonth")}
					onChange={(next) =>
						patch(() => {
							setAnchor(Number(next));
							setFirst(nextOnDay(today, Number(next)));
						})
					}
					options={DAYS_IN_MONTH.map((d) => ({ value: d, label: d }))}
					value={String(dayOfMonth)}
				/>
			) : (
				<DateField
					label={t("add.first")}
					minimum={today}
					onChange={(next) => patch(() => setFirst(next))}
					value={first}
				/>
			)}
			<OptionRow
				filled
				icon="Zap"
				name={t("item.autoPay")}
				on={autoPay}
				onPress={() => patch(() => setAutoPay(!autoPay))}
				state={autoPay ? tc("extras.on") : tc("extras.off")}
			/>
		</View>,
		<PreviewChanges
			key="changes"
			lead={[
				{ key: "repeats", label: t("add.repeats"), value: frequencyWord },
				{ key: "first", label: t("add.first"), value: day(first) },
			]}
			preview={flow.preview}
			status={flow.status}
		/>,
	];

	const spoken =
		minor !== null
			? tc("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: tc("amountEmpty", { currency });
	const line: MoneyLine = {
		key: "amount",
		currency: (
			<CurrencyPicker
				currencies={currencies.currencies}
				onChange={(next) => {
					setCurrency(next);
					setText("");
				}}
				recent={currencies.recent}
				value={currency}
				yours={currencies.yours}
			/>
		),
		text,
		placeholder: "0",
		spoken,
		active: true,
		onPress: pad.requestKeypad,
	};
	const amountError = tried && minor === null;

	return (
		<ComposerFrame
			add={{
				onPress: () => void submit(),
				label: t("add.submit"),
				description: t("add.title"),
				folded: t("add.title"),
				off: flow.status !== "ready" || flow.committing,
				busy: flow.committing,
			}}
			amount={
				<AmountEntry
					currency={currency}
					error={amountError}
					line={line}
					onFocusChange={pad.setTyping}
					onPress={pad.requestKeypad}
					onText={setText}
					padOpen={pad.padOpen}
					system={pad.system}
					text={text}
					typing={pad.typing}
				/>
			}
			changedLabel={tc("tabs.changed")}
			header={<SheetHead onCancel={onClose} title={t("add.title")} />}
			keypad={{ text, currency, kind: "money", onChange: setText }}
			keypadOpen={pad.padOpen}
			onPageChange={(next) => pad.goTo(next)}
			onScrollDrag={() => {
				if (pad.system) pad.setPadOpen(false);
			}}
			page={pad.page}
			panels={panels}
			preview={
				<LinePreview
					failed={flow.commitFailed}
					preview={flow.preview}
					status={flow.status}
				/>
			}
			summary={parts}
			surface
			tabs={tabs}
			tabsLabel={tc("tabs.label")}
			title={
				<TextField
					align="center"
					autoCapitalize="sentences"
					bare
					hideLabel
					invalid={tried && title === ""}
					label={t("add.name")}
					maxLength={191}
					onChangeText={setName}
					onTypingChange={pad.setTyping}
					placeholder={t("add.namePlaceholder")}
					value={name}
				/>
			}
			typing={pad.typing}
		/>
	);
}

function keyOf(f: Frequency): FrequencyKey {
	return FREQUENCIES.find((x) => x.value === f)?.key ?? "monthly";
}

/** The one-line preview: what the dry run says, or that it could not be saved. */
function LinePreview({
	status,
	preview,
	failed,
}: {
	status: PreviewStatus;
	preview: FigureDiff | null;
	failed: boolean;
}) {
	const tcc = useTranslations("mobile.composer.changes");
	const tr = useTranslations("mobile.recurring");
	const tp = useTranslations("mobile.budget.preview");
	const money = useMoneyText();
	const label = useFigureLabel();
	if (failed) {
		return (
			<Text numberOfLines={1} tone="attention" variant="small">
				{tr("add.error")}
			</Text>
		);
	}
	// Nothing to show while it is asked, before it can be, or when no figure moves.
	if (status === "idle" || status === "loading") return null;
	let words: string;
	let tone: "fg2" | "attention" = "fg2";
	if (status === "failed") words = tcc("offline");
	else if (status === "refused") {
		tone = "attention";
		words = tcc("refused");
	} else {
		const first = preview ? figureLines(preview).changes[0] : undefined;
		const side = (m: Money | null) => (m ? money(m) : tp("notAvailable"));
		if (!first) return null;
		words = `${label(first.id).name} ${tp("beforeAfter", {
			before: side(first.before),
			after: side(first.after),
		})}`;
	}
	return (
		<Text
			accessibilityLiveRegion="polite"
			numberOfLines={1}
			tabular
			tone={tone}
			variant="small"
		>
			{words}
		</Text>
	);
}

/** The Add recurring sheet: the composer on the large sheet, loaded with the catalog. */
export function AddRecurring({
	visible,
	onClose,
	onDone,
}: {
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const catalog = useEntryCatalog();
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
				{visible && catalog.status === "ready" ? (
					<RecurringComposer
						catalog={catalog.catalog}
						onClose={onClose}
						onDone={onDone}
					/>
				) : null}
			</View>
		</Sheet>
	);
}
