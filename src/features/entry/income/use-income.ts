"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { dayKey } from "@retrospend/domain/time-zone";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useState } from "react";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";
import { type EntryCatalog, useSettled } from "../shared-ui";

export type IncomeDraft = {
	currency: string;
	amountText: string;
	minor: number | null;
	rateType: string | null;
	source: string;
	categoryId: string | null;
	/** An account id, or null for no account (N75: accounts unchanged). */
	into: string | null;
	/** null = the account's default ("Part of my budget"). */
	keep: boolean | null;
	date: string;
	repeats: boolean;
	note: string;
	/** Use my plan; null until picked: on when you have an envelope budget (N72). */
	usePlan: boolean | null;
};

/**
 * Add income (owner N71: its own sheet, INCOME.md): state, the server's
 * preview of income.add with Use my plan, and the save with its undo.
 */
export function useIncome(catalog: EntryCatalog, accountId?: string) {
	const locale = useLocale();
	const home = catalog.homeCurrency;
	const [d, setD] = useState<IncomeDraft>(() => {
		const account = catalog.places.find((p) => p.id === accountId);
		const currency = account?.currency ?? home;
		return {
			currency,
			amountText: "",
			minor: null,
			rateType: null,
			source: "",
			categoryId: null,
			into: account?.id ?? catalog.defaultAccounts[currency] ?? null,
			keep: null,
			date: dayKey(new Date()),
			repeats: false,
			note: "",
			// Use my plan is the primary path (N72), but only with an envelope budget to fill.
			usePlan: null,
		};
	});
	const set = (patch: Partial<IncomeDraft>) =>
		setD((x) => ({ ...x, ...patch }));
	const account = catalog.places.find((p) => p.id === d.into) ?? null;
	const kept = d.into ? (d.keep ?? !account?.inBudget) : false;
	const category = catalog.categories.find((c) => c.id === d.categoryId);
	const foreign = d.currency !== home;
	// Null: no envelope budget, so Use my plan has nothing to fill.
	const budgets = api.envelope.enabled.useQuery();
	const book = api.envelope.getMonth.useQuery(
		{},
		{ retry: false, enabled: budgets.data === true },
	);
	const usePlan = d.usePlan ?? !!book.data;
	// The sheet's own id: a second click on Add income cannot write a second row.
	const [id] = useState(generateId);

	const rates = api.entry.rateOptions.useQuery(
		useSettled({
			currency: d.currency,
			date: d.date,
			amount: d.minor
				? fromMinor({ minor: d.minor, currency: d.currency })
				: undefined,
		}),
		{ enabled: foreign, placeholderData: (p) => p },
	);
	const rateType = foreign
		? (d.rateType ?? rates.data?.defaultType ?? null)
		: null;
	const missing = foreign && !!rates.data?.missing;
	const errors = {
		amount: !d.minor,
		rate: missing,
		category: !d.categoryId,
		source: !d.source.trim(),
	};
	const valid = !Object.values(errors).some(Boolean);
	const input = valid
		? {
				title: `${category?.name ?? ""}, ${d.source.trim()}`,
				amount: fromMinor({ minor: d.minor ?? 0, currency: d.currency }),
				currency: d.currency,
				...(rateType ? { rateType } : {}),
				categoryId: d.categoryId,
				date: d.date,
				...(d.note.trim() ? { description: d.note.trim() } : {}),
				into: d.into,
				...(d.into ? { keep: kept } : {}),
				...(d.repeats ? { repeats: { frequency: "MONTHLY" as const } } : {}),
				usePlan: !kept && usePlan,
			}
		: null;
	const settled = useSettled(input, 350);
	const preview = api.wealth.income.add.preview.useQuery(settled ?? EMPTY, {
		enabled: !!settled,
		placeholderData: keepPreviousData,
		retry: false,
	});
	const save = api.wealth.income.add.save.useMutation();
	const undo = api.wealth.income.delete.save.useMutation();
	return {
		d,
		set,
		setAmount: (text: string) => {
			const r = parseMoneyInput(text, locale, d.currency);
			set({ amountText: text, minor: r.ok ? r.minor : null });
		},
		setCurrency: (currency: string) =>
			set({
				currency,
				rateType: null,
				amountText: "",
				minor: null,
				into: catalog.defaultAccounts[currency] ?? null,
				keep: null,
			}),
		account,
		kept,
		foreign,
		rates: rates.data,
		rateType,
		usePlan,
		hasBudget: !!book.data,
		errors,
		valid,
		input,
		preview: valid ? (preview.data ?? null) : null,
		previewLoading: preview.isFetching,
		previewError: preview.error?.message ?? null,
		save: () =>
			input
				? save.mutateAsync({ ...input, id })
				: Promise.reject(new Error("Nothing to save")),
		undo: (expenseId: string, templateId: string | null) =>
			undo.mutateAsync({ expenseId, templateId }),
		busy: save.isPending,
	};
}

const EMPTY = { title: "x", amount: "1", currency: "USD" };
