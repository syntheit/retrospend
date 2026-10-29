import { useMemo } from "react";
import { useTranslations } from "use-intl";
import {
	buildExpenseUpdate,
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	knownPeople,
	type PendingWrite,
	splitRows,
} from "./draft";
import { useEntryPreview } from "./hooks";
import { planOf, splitSharesOf } from "./preview";
import type { EntryForm } from "./useEntryForm";

/**
 * The write the open mode would send, the server's dry run of exactly that
 * body, and what the screens show from it: whether Save has to wait, the
 * split rows with the server's shares, and what Use my plan would assign.
 * Nothing here computes a figure.
 */
export function useComposerPreview(form: EntryForm) {
	const t = useTranslations("mobile.composer");
	const { catalog, editing, expense, income, transfer, locale, meId, mode } =
		form;
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
	const write: PendingWrite | null =
		mode === "expense"
			? expenseWrite
			: mode === "income"
				? incomeWrite
				: transferWrite;
	const { state: preview, retry } = useEntryPreview(write);
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
	// Each share is the server's, from the dry run of this very write.
	const shares = useMemo(
		() =>
			mode === "expense" && preview.status === "ready"
				? splitSharesOf(preview.diff)
				: null,
		[mode, preview],
	);
	const rows = useMemo(
		() =>
			splitRows(expense, {
				locale,
				meId,
				people: knownPeople(expense, catalog.people),
				youLabel: t("you"),
				shares,
			}),
		[expense, locale, meId, catalog.people, t, shares],
	);
	return { write, preview, retry, plan, blocked, rows };
}

export type ComposerPreview = ReturnType<typeof useComposerPreview>;
