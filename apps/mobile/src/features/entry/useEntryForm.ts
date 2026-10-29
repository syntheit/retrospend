import { fromMinor, money } from "@retrospend/domain/money-minor";
import { decimalSeparator } from "@retrospend/domain/parse";
import { parseRateText } from "@retrospend/domain/rate-text";
import { dayKey } from "@retrospend/domain/time-zone";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyLocale } from "@/lib/money";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { useToast } from "@/ui/Toast";
import type { EntryMode } from "./ComposerShell";
import {
	amountMinor,
	DEFAULT_RATE,
	type ExpenseDraft,
	expenseErrors,
	expenseFromEntry,
	type IncomeDraft,
	incomeErrors,
	isPersonal,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	sharedFromDetail,
	type TransferDraft,
	transferCurrencies,
	transferErrors,
} from "./draft";
import { type SavedEntry, useRateOptions } from "./hooks";
import { type EntryCatalog, personKey } from "./types";

const today = () => dayKey(new Date());

/** Which of the composer's two steps shows: the quick one, or More. */
export type EntryStep = "quick" | "more";

/** Which amount the keypad types into: a transfer has the one it sends and the one that arrives. */
export type AmountTarget = "amount" | "received";

export interface EntryFormInput {
	catalog: EntryCatalog;
	initialMode: EntryMode;
	prefill?: ComposerPrefill;
	edit?: SavedEntry;
	onDirtyChange?: (dirty: boolean) => void;
}

/** The drafts with a prefill laid over them; the amount is shown in the person's own separators. */
function filled<T extends { expense: ExpenseDraft; income: IncomeDraft }>(
	drafts: T,
	prefill: ComposerPrefill | undefined,
	locale: string,
	currencies: string[],
) {
	if (!prefill) return drafts;
	const currency =
		prefill.currency && currencies.includes(prefill.currency)
			? prefill.currency
			: undefined;
	const amountText = prefill.amount
		? prefill.amount.replace(".", decimalSeparator(locale))
		: "";
	return {
		...drafts,
		expense: {
			...drafts.expense,
			amountText,
			currency: currency ?? drafts.expense.currency,
			title: prefill.mode === "expense" ? (prefill.title ?? "") : "",
		},
		income: {
			...drafts.income,
			amountText,
			currency: currency ?? drafts.income.currency,
			source: prefill.mode === "income" ? (prefill.title ?? "") : "",
		},
	};
}

/**
 * The composer's state: the three drafts, the mode and the step, what is
 * being typed, and the pure reads of them (errors, rate options, the amount
 * the keypad works on). Writing, the dry run and saving live in their own
 * hooks; this one only holds what the person has entered.
 */
export function useEntryForm({
	catalog,
	initialMode,
	prefill,
	edit,
	onDirtyChange,
}: EntryFormInput) {
	const t = useTranslations("mobile.composer");
	const locale = useMoneyLocale();
	const toast = useToast();
	const { api, state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const fresh = useCallback(
		() => ({
			expense: newExpenseDraft({
				id: newClientId(),
				currency: me?.defaultCurrency ?? "USD",
				date: today(),
			}),
			income: newIncomeDraft({
				id: newClientId(),
				currency: me?.homeCurrency ?? "USD",
				date: today(),
				usePlan: catalog.hasBudget === true,
			}),
			transfer: newTransferDraft({
				id: newClientId(),
				currency: me?.defaultCurrency ?? "USD",
				date: today(),
				places: catalog.places,
			}),
		}),
		[me?.defaultCurrency, me?.homeCurrency, catalog.hasBudget, catalog.places],
	);
	const editing = edit !== undefined;
	const modes: EntryMode[] = editing
		? ["expense"]
		: catalog.places.length >= 2
			? ["expense", "income", "transfer"]
			: ["expense", "income"];
	const [mode, setMode] = useState<EntryMode>(
		modes.includes(initialMode) ? initialMode : "expense",
	);
	const [step, setStep] = useState<EntryStep>("quick");
	const [target, setTarget] = useState<AmountTarget>("amount");
	const [drafts, setDrafts] = useState(() => {
		const start = filled(fresh(), prefill, locale, catalog.currencies);
		if (!edit) return start;
		return {
			...start,
			expense:
				edit.kind === "shared"
					? sharedFromDetail(edit.entry, locale)
					: expenseFromEntry(edit.entry, locale),
		};
	});
	const [tried, setTried] = useState(false);
	const [typing, setTyping] = useState(false);
	// Scrolling the fields folds the keypad away so the split and what changes
	// show in full; touching the amount brings it back.
	const [padOpen, setPadOpen] = useState(true);
	const requestKeypad = () => {
		Keyboard.dismiss();
		setTyping(false);
		setPadOpen(true);
	};

	// Any change makes new drafts; the host asks before replacing them.
	const opened = useRef(drafts);
	const dirty = drafts !== opened.current;
	/** Puts every field back as it was when the composer opened. */
	const undoChanges = () => {
		setDrafts(opened.current);
		setTarget("amount");
		setTried(false);
	};
	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);

	// Android keeps a field focused after the keyboard is dismissed.
	useEffect(() => {
		const hide = Keyboard.addListener("keyboardDidHide", () =>
			setTyping(false),
		);
		return () => hide.remove();
	}, []);

	const expense = drafts.expense;
	const income = drafts.income;
	const transfer = drafts.transfer;
	const meId = me?.id ?? "";

	const patchExpense = (patch: Partial<ExpenseDraft>) =>
		setDrafts((d) => ({ ...d, expense: { ...d.expense, ...patch } }));
	const patchIncome = (patch: Partial<IncomeDraft>) =>
		setDrafts((d) => ({ ...d, income: { ...d.income, ...patch } }));
	const patchTransfer = (patch: Partial<TransferDraft>) =>
		setDrafts((d) => ({ ...d, transfer: { ...d.transfer, ...patch } }));

	const expenseProblems = expenseErrors(expense, locale, catalog.categories);
	const incomeProblems = incomeErrors(income, locale);
	const transferProblems = transferErrors(transfer, {
		locale,
		places: catalog.places,
	});
	const amountProblem =
		mode === "expense"
			? expenseProblems.amount
			: mode === "income"
				? incomeProblems.amount
				: transferProblems.amount;

	// The currencies of a transfer are its accounts'; what arrives only exists for an exchange.
	const currencies = transferCurrencies(transfer, catalog.places);
	const fromCurrency = currencies.from ?? me?.homeCurrency ?? "USD";
	const exchange =
		mode === "transfer" &&
		currencies.from !== null &&
		currencies.to !== null &&
		currencies.from !== currencies.to;
	const keypadTarget: AmountTarget = exchange ? target : "amount";

	// The amount and currency the keypad works on.
	const keypad =
		mode === "expense"
			? { text: expense.amountText, currency: expense.currency }
			: mode === "income"
				? { text: income.amountText, currency: income.currency }
				: keypadTarget === "received"
					? { text: transfer.receivedText, currency: currencies.to ?? "" }
					: { text: transfer.amountText, currency: fromCurrency };
	const patchAmount = (amountText: string) =>
		mode === "expense"
			? patchExpense({ amountText })
			: mode === "income"
				? patchIncome({ amountText })
				: keypadTarget === "received"
					? patchTransfer({ receivedText: amountText })
					: patchTransfer({ amountText });
	/** The first amount in minor units: Add stays off at zero. */
	const typedAmount = amountMinor(
		mode === "expense"
			? expense.amountText
			: mode === "income"
				? income.amountText
				: transfer.amountText,
		locale,
		mode === "expense"
			? expense.currency
			: mode === "income"
				? income.currency
				: fromCurrency,
	);

	// Another currency than home: the rate and the value at home, as the server books them.
	const homeCurrency = me?.homeCurrency ?? "USD";
	const rated =
		mode === "expense" ? expense : mode === "income" ? income : null;
	const foreign = rated !== null && rated.currency !== homeCurrency;
	const typedMinor = rated
		? amountMinor(rated.amountText, locale, rated.currency)
		: null;
	const rateOptions = useRateOptions(
		{
			currency: rated?.currency ?? homeCurrency,
			date: rated?.date ?? today(),
			amount:
				rated && typedMinor
					? fromMinor(money(typedMinor, rated.currency))
					: null,
			customRate:
				rated?.custom === true ? parseRateText(rated.customText, locale) : null,
		},
		foreign,
	);
	const rateProblem =
		mode === "expense"
			? expenseProblems.rate
			: mode === "income"
				? incomeProblems.rate
				: undefined;
	// A split books at your default type: the type is stated, not picked.
	const sharedExpense =
		mode === "expense" &&
		(expense.editing
			? expense.editing.source === "shared"
			: !isPersonal(expense));

	// The latest pick: a slower answer for an earlier project is dropped.
	const projectPick = useRef(0);

	// A project's people depend on the day, so a new date reads them again.
	// An edit keeps its people and its project (the server splits it again the
	// saved way), so it reads nothing: a failed read must not drop the project.
	const pickedDate = useRef(expense.date);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a date change re-reads the people
	useEffect(() => {
		if (pickedDate.current === expense.date) return;
		pickedDate.current = expense.date;
		if (expense.editing) return;
		if (expense.projectId) void pickProject(expense.projectId);
	}, [expense.date]);

	/** Picks the project and takes in its people on the expense's day, as the web does. */
	async function pickProject(projectId: string | null) {
		// An edit can not move an expense between projects.
		if (expense.editing) return;
		const pick = ++projectPick.current;
		if (!projectId) {
			patchExpense({ projectId: null, projectPeople: [], withKeys: [] });
			return;
		}
		const project = catalog.projects.find((p) => p.id === projectId);
		try {
			if (!api) throw new Error("offline");
			const { items } = await api.projects.members({
				id: projectId,
				date: expense.date,
			});
			const people = items
				.filter(
					(m) => !(m.participantType === "user" && m.participantId === meId),
				)
				.map((m) => ({
					type: m.participantType,
					id: m.participantId,
					name: m.name,
					imageUrl: m.imageUrl,
				}));
			if (pick !== projectPick.current) return;
			patchExpense({
				projectId,
				projectPeople: people,
				withKeys: people.map(personKey),
				// The project's currency, until an amount is typed in another.
				...(!expense.amountText &&
				project &&
				catalog.currencies.includes(project.currency)
					? { currency: project.currency, ...DEFAULT_RATE }
					: {}),
			});
		} catch {
			if (pick !== projectPick.current) return;
			// The project stays unpicked: a split without its people would be wrong.
			patchExpense({ projectId: null, projectPeople: [], withKeys: [] });
			toast.show({ message: t("project.loadFailed") });
		}
	}

	return {
		me,
		meId,
		locale,
		homeCurrency,
		catalog,
		editing,
		modes,
		mode,
		setMode,
		step,
		setStep,
		target: keypadTarget,
		setTarget,
		drafts,
		setDrafts,
		fresh,
		expense,
		income,
		transfer,
		patchExpense,
		patchIncome,
		patchTransfer,
		tried,
		setTried,
		typing,
		setTyping,
		padOpen,
		setPadOpen,
		requestKeypad,
		dirty,
		undoChanges,
		expenseProblems,
		incomeProblems,
		transferProblems,
		amountProblem,
		exchange,
		toCurrency: currencies.to,
		fromCurrency,
		keypad,
		patchAmount,
		typedAmount,
		rated,
		foreign,
		rateOptions,
		rateProblem,
		sharedExpense,
		pickProject,
	};
}

export type EntryForm = ReturnType<typeof useEntryForm>;
