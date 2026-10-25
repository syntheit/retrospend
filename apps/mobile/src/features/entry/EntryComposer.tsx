import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useFormatLocale } from "@/lib/intl";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { useToast } from "@/ui/Toast";
import { dayKey } from "@retrospend/domain/time-zone";
import { ChangesBlock } from "./ChangesBlock";
import { ComposerShell, type EntryMode } from "./ComposerShell";
import {
	buildExpenseWrite,
	buildIncomeWrite,
	expenseErrors,
	incomeErrors,
	newExpenseDraft,
	newIncomeDraft,
	splitRows,
} from "./draft";
import { announceEntryChange } from "./events";
import { ExpenseFields } from "./ExpenseFields";
import { useEntryCatalog, useEntryPreview } from "./hooks";
import { IncomeFields } from "./IncomeFields";
import { type SaveOutcome, saveEntry, undoSaved } from "./queue";
import type { EntryCatalog } from "./types";

/**
 * Add expense and Add income in one frame. The same component sits in the
 * iPhone tab, the iPad form sheet and the Android bottom sheet; `onDone`
 * closes whichever it is in.
 */
export function EntryComposer({
	onDone,
	initialMode = "expense",
	onModeChange,
}: {
	onDone: () => void;
	initialMode?: EntryMode;
	/** The host shows the mode in its title. */
	onModeChange?: (mode: EntryMode) => void;
}) {
	const t = useTranslations("mobile.entry");
	const catalog = useEntryCatalog();
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
	return (
		<Form
			catalog={catalog.catalog}
			initialMode={initialMode}
			onDone={onDone}
			onModeChange={onModeChange}
		/>
	);
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
	initialMode,
	onDone,
	onModeChange,
}: {
	catalog: EntryCatalog;
	initialMode: EntryMode;
	onDone: () => void;
	onModeChange?: (mode: EntryMode) => void;
}) {
	const t = useTranslations("mobile.entry");
	const locale = useFormatLocale();
	const toast = useToast();
	const { api, local, state } = useSession();
	const { color, space } = useTheme();
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
		}),
		[me?.defaultCurrency, me?.homeCurrency, catalog.hasBudget],
	);
	const [mode, setMode] = useState(initialMode);
	const [drafts, setDrafts] = useState(fresh);
	const [tried, setTried] = useState(false);
	const [typing, setTyping] = useState(false);
	const [busy, setBusy] = useState(false);

	const expense = drafts.expense;
	const income = drafts.income;
	const meId = me?.id ?? "";
	const expenseWrite = useMemo(
		() => buildExpenseWrite(expense, { locale, meId, catalog }),
		[expense, locale, meId, catalog],
	);
	const incomeWrite = useMemo(
		() => buildIncomeWrite(income, { locale, hasBudget: catalog.hasBudget }),
		[income, locale, catalog.hasBudget],
	);
	const write = mode === "expense" ? expenseWrite : incomeWrite;
	const preview = useEntryPreview(write);
	const rows = useMemo(
		() =>
			splitRows(expense, {
				locale,
				meId,
				people: catalog.people,
				youLabel: t("you"),
			}),
		[expense, locale, meId, catalog.people, t],
	);
	const expenseProblems = expenseErrors(expense, locale);
	const incomeProblems = incomeErrors(income, locale);
	const amountProblem =
		mode === "expense" ? expenseProblems.amount : incomeProblems.amount;

	const patchExpense = (patch: Partial<typeof expense>) =>
		setDrafts((d) => ({ ...d, expense: { ...d.expense, ...patch } }));
	const patchIncome = (patch: Partial<typeof income>) =>
		setDrafts((d) => ({ ...d, income: { ...d.income, ...patch } }));
	const active = mode === "expense" ? expense : income;
	const patchActive = mode === "expense" ? patchExpense : patchIncome;

	async function add() {
		setTried(true);
		if (!write || !api || !local || busy) return;
		setBusy(true);
		const outcome = await saveEntry({ outbox: local.outbox, api, write });
		setBusy(false);
		announceEntryChange();
		const clientId = String(write.body.id);
		showSaved(outcome, write.label, async () => {
			const result = await undoSaved({
				outbox: local.outbox,
				api,
				clientId,
				outcome,
			});
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
		toast.show({
			message,
			undo:
				outcome.status === "parked" ? undefined : { label: t("undo"), onUndo },
		});
	}

	return (
		<ComposerShell
			addDescription={mode === "expense" ? t("addExpense") : t("addIncome")}
			addLabel={t("add")}
			amountError={tried && amountProblem === true}
			amountText={active.amountText}
			busy={busy}
			currencies={catalog.currencies}
			currency={active.currency}
			mode={mode}
			onAdd={add}
			onAmountChange={(amountText) => patchActive({ amountText })}
			onCurrencyChange={(currency) => patchActive({ currency, amountText: "" })}
			onModeChange={(next) => {
				setMode(next);
				setTried(false);
				onModeChange?.(next);
			}}
			typing={typing}
		>
			<View style={{ gap: space[4], backgroundColor: color.bg }}>
				{mode === "expense" ? (
					<ExpenseFields
						catalog={catalog}
						draft={expense}
						errors={tried ? expenseProblems : {}}
						onChange={patchExpense}
						onTypingChange={setTyping}
						rows={rows}
					/>
				) : (
					<IncomeFields
						catalog={catalog}
						draft={income}
						errors={tried ? incomeProblems : {}}
						onChange={patchIncome}
						onTypingChange={setTyping}
					/>
				)}
				<ChangesBlock
					idle={
						mode === "expense"
							? t("changes.emptyExpense")
							: t("changes.emptyIncome")
					}
					state={preview}
				/>
			</View>
		</ComposerShell>
	);
}
