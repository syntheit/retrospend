import { decimalSeparator } from "@retrospend/domain/parse";
import { dayKey } from "@retrospend/domain/time-zone";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyLocale } from "@/lib/money";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { useToast } from "@/ui/Toast";
import { ChangesBlock } from "./ChangesBlock";
import { ComposerShell, type EntryMode } from "./ComposerShell";
import {
	buildExpenseUpdate,
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	type ExpenseDraft,
	expenseErrors,
	expenseFromEntry,
	type IncomeDraft,
	incomeErrors,
	knownPeople,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	sharedFromDetail,
	splitRows,
	type TransferDraft,
	transferCurrencies,
	transferErrors,
} from "./draft";
import { ExpenseFields } from "./ExpenseFields";
import { saveExpenseEdit } from "./edit";
import { announceEntryChange } from "./events";
import {
	type SavedEntry,
	useEditEntry,
	useEntryCatalog,
	useEntryPreview,
} from "./hooks";
import { IncomeFields } from "./IncomeFields";
import { PlanBlock } from "./PlanBlock";
import { planOf } from "./preview";
import { type SaveOutcome, saveEntry, undoSaved } from "./queue";
import { SyncIssues } from "./SyncIssues";
import { undoWrite } from "./send";
import { TransferFields } from "./TransferFields";
import { type EntryCatalog, personKey } from "./types";

interface ComposerProps {
	onDone: () => void;
	initialMode?: EntryMode;
	/** The host shows the mode in its title. */
	onModeChange?: (mode: EntryMode) => void;
	/** The composer sits on a sheet: it takes the sheet's surface, not the page's. */
	surface?: boolean;
	/** What a share, a Shortcut or a retrospend://add link filled in. */
	prefill?: ComposerPrefill;
	/** The saved expense to edit; the composer then edits it instead of adding. */
	editId?: string;
	/** The id is a split expense's, not a personal one's. */
	editShared?: boolean;
}

/**
 * Add expense and Add income in one frame. The same component sits in the
 * iPhone tab, the iPad form sheet and the Android bottom sheet; `onDone`
 * closes whichever it is in.
 */
export function EntryComposer(props: ComposerProps) {
	const t = useTranslations("mobile.composer");
	const catalog = useEntryCatalog();
	const edit = useEditEntry(props.editId, props.editShared);
	const { state } = useSession();
	// The profile is cached on sign in; without it there is no "you" to split with.
	if (state.status !== "signedIn" || !state.me) {
		return <Notice detail={t("loadErrorDetail")} title={t("loadError")} />;
	}
	if (catalog.status === "loading") {
		return <Notice title={t("loading")} />;
	}
	if (catalog.status === "error") {
		return <Notice detail={t("loadErrorDetail")} title={t("loadError")} />;
	}
	if (edit.status === "loading") return <Notice title={t("loading")} />;
	if (edit.status === "error") {
		return <Notice detail={t("loadErrorDetail")} title={t("editLoadError")} />;
	}
	if (edit.status === "ready" && edit.saved.kind === "shared") {
		// A payment settled it, or the project does not let you: the server refuses either.
		if (!edit.saved.entry.canEdit) {
			return <Notice detail={t("editLockedDetail")} title={t("editLocked")} />;
		}
	}
	return (
		<Form
			{...props}
			catalog={catalog.catalog}
			edit={edit.status === "ready" ? edit.saved : undefined}
		/>
	);
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

function Notice({ title, detail }: { title: string; detail?: string }) {
	const { color } = useTheme();
	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			<EmptyState detail={detail} title={title} />
		</View>
	);
}

function Form({
	catalog,
	initialMode = "expense",
	onDone,
	onModeChange,
	surface,
	prefill,
	edit,
}: ComposerProps & {
	catalog: EntryCatalog;
	edit?: SavedEntry;
}) {
	const t = useTranslations("mobile.composer");
	const locale = useMoneyLocale();
	const toast = useToast();
	const { api, local, state } = useSession();
	const { color, space, type } = useTheme();
	const me = state.status === "signedIn" ? state.me : null;
	const today = () => dayKey(new Date());
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
	const [busy, setBusy] = useState(false);

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
	const expenseWrite = useMemo(
		() =>
			expense.editing
				? buildExpenseUpdate(expense, { locale, catalog })
				: buildExpenseWrite(expense, { locale, meId, catalog }),
		[expense, locale, meId, catalog],
	);
	const incomeWrite = useMemo(
		() => buildIncomeWrite(income, { locale, hasBudget: catalog.hasBudget }),
		[income, locale, catalog.hasBudget],
	);
	const transferWrite = useMemo(
		() => buildTransferWrite(transfer, { locale, places: catalog.places }),
		[transfer, locale, catalog.places],
	);
	const write =
		mode === "expense"
			? expenseWrite
			: mode === "income"
				? incomeWrite
				: transferWrite;
	const preview = useEntryPreview(write);
	// Use my plan: the lines it would write come with the same dry run.
	const plan =
		mode === "income" && income.usePlan && preview.status === "ready"
			? planOf(preview.diff)
			: null;
	// Save waits for the dry run of exactly what it will send. Offline there is
	// none and an add waits on the phone, but an edit is never queued: it needs
	// the dry run, so only a ready one lets it through. A refused one can not be saved.
	const blocked =
		write !== null &&
		preview.status !== "ready" &&
		(editing || preview.status !== "offline");
	const rows = useMemo(
		() =>
			splitRows(expense, {
				locale,
				meId,
				people: knownPeople(expense, catalog.people),
				youLabel: t("you"),
			}),
		[expense, locale, meId, catalog.people, t],
	);
	const expenseProblems = expenseErrors(expense, locale);
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

	const patchExpense = (patch: Partial<typeof expense>) =>
		setDrafts((d) => ({ ...d, expense: { ...d.expense, ...patch } }));
	const patchIncome = (patch: Partial<typeof income>) =>
		setDrafts((d) => ({ ...d, income: { ...d.income, ...patch } }));
	const patchTransfer = (patch: Partial<TransferDraft>) =>
		setDrafts((d) => ({ ...d, transfer: { ...d.transfer, ...patch } }));
	// The amount and currency the keypad works on: a transfer's are its source account's.
	const fromCurrency =
		transferCurrencies(transfer, catalog.places).from ??
		me?.homeCurrency ??
		"USD";
	const active =
		mode === "expense"
			? { amountText: expense.amountText, currency: expense.currency }
			: mode === "income"
				? { amountText: income.amountText, currency: income.currency }
				: { amountText: transfer.amountText, currency: fromCurrency };
	const patchAmount = (amountText: string) =>
		mode === "expense"
			? patchExpense({ amountText })
			: mode === "income"
				? patchIncome({ amountText })
				: patchTransfer({ amountText });

	// The latest pick: a slower answer for an earlier project is dropped.
	const projectPick = useRef(0);

	/** Picks the project and takes in its people on the expense's day, as the web does. */
	async function pickProject(projectId: string | null) {
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
					? { currency: project.currency }
					: {}),
			});
		} catch {
			if (pick !== projectPick.current) return;
			// The project stays unpicked: a split without its people would be wrong.
			toast.show({ message: t("project.loadFailed") });
		}
	}

	async function saveEdit() {
		if (!write || !api || busy || blocked) return;
		setBusy(true);
		const outcome = await saveExpenseEdit(api, write).finally(() =>
			setBusy(false),
		);
		if (outcome.status !== "saved") {
			toast.show({
				message:
					outcome.status === "offline"
						? t("toast.editOffline")
						: t("toast.editRefused"),
			});
			return;
		}
		announceEntryChange();
		const { undo } = outcome;
		toast.show({
			message: t("toast.edited", { title: write.label }),
			undo: {
				label: t("undo"),
				onUndo: async () => {
					const ok = await undoWrite(api, undo, newClientId()).then(
						() => true,
						() => false,
					);
					announceEntryChange();
					toast.show({
						message: ok
							? t("toast.restored", { title: write.label })
							: t("toast.undoFailed"),
					});
				},
			},
		});
		onDone();
	}

	async function add() {
		setTried(true);
		if (editing) return saveEdit();
		if (!write || !api || !local || busy || blocked) return;
		setBusy(true);
		let outcome: SaveOutcome;
		try {
			outcome = await saveEntry({ outbox: local.outbox, api, write });
		} finally {
			setBusy(false);
		}
		announceEntryChange();
		const clientId = String(write.body.id);
		showSaved(outcome, write.label, async () => {
			const result = await undoSaved({ outbox: local.outbox, api, clientId });
			announceEntryChange();
			toast.show({
				message:
					result === "undone"
						? t("toast.undone", { title: write.label })
						: t("toast.undoFailed"),
			});
		});
		setDrafts(fresh());
		setTried(false);
		onDone();
	}

	function showSaved(outcome: SaveOutcome, title: string, onUndo: () => void) {
		const message =
			outcome.status === "synced"
				? t("toast.added", { title })
				: outcome.status === "queued"
					? t("toast.queued", { title })
					: t("toast.parked", { title });
		const undoable =
			outcome.status === "queued" ||
			(outcome.status === "synced" && outcome.undo !== null);
		toast.show({
			message,
			undo: undoable ? { label: t("undo"), onUndo } : undefined,
		});
	}

	return (
		<ComposerShell
			addDescription={
				editing
					? t("saveExpense")
					: mode === "expense"
						? t("addExpense")
						: mode === "income"
							? t("addIncome")
							: t("addTransfer")
			}
			addLabel={editing ? t("save") : t("add")}
			amountError={tried && amountProblem === true}
			amountText={active.amountText}
			blocked={blocked}
			busy={busy}
			currencies={catalog.currencies}
			currency={active.currency}
			currencyLocked={
				mode === "transfer" || expense.editing?.source === "shared"
			}
			mode={mode}
			modes={modes}
			onAdd={add}
			onAmountChange={patchAmount}
			onCurrencyChange={(currency) =>
				mode === "income"
					? patchIncome({ currency, amountText: "" })
					: patchExpense({ currency, amountText: "" })
			}
			onKeypadRequest={() => setTyping(false)}
			onModeChange={(next) => {
				setMode(next);
				setTried(false);
				onModeChange?.(next);
			}}
			recentCurrencies={catalog.recentCurrencies}
			surface={surface}
			typing={typing}
			yourCurrencies={[me?.homeCurrency, me?.defaultCurrency].filter(
				(code): code is string => Boolean(code),
			)}
		>
			<View style={{ gap: space[4] }}>
				<SyncIssues />
				{prefill?.file ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{t("sharedFileNotice")}
					</Text>
				) : null}
				{mode === "expense" ? (
					<ExpenseFields
						catalog={catalog}
						draft={expense}
						errors={tried ? expenseProblems : {}}
						onChange={patchExpense}
						onProject={pickProject}
						onTypingChange={setTyping}
						rows={rows}
					/>
				) : mode === "income" ? (
					<IncomeFields
						catalog={catalog}
						draft={income}
						errors={tried ? incomeProblems : {}}
						onChange={patchIncome}
						onTypingChange={setTyping}
					/>
				) : (
					<TransferFields
						draft={transfer}
						errors={tried ? transferProblems : {}}
						onChange={patchTransfer}
						onTypingChange={setTyping}
						places={catalog.places}
					/>
				)}
				<ChangesBlock
					idle={
						mode === "expense"
							? t("changes.emptyExpense")
							: mode === "income"
								? t("changes.emptyIncome")
								: t("changes.emptyTransfer")
					}
					state={preview}
				/>
				{plan ? <PlanBlock plan={plan} /> : null}
			</View>
		</ComposerShell>
	);
}
