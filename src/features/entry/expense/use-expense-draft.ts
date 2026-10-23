"use client";

import { toMinorUnits } from "@retrospend/domain/money";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { predictCategory } from "~/lib/category-matcher";
import {
	type SplitRef,
	splitKey,
	splitMembers,
} from "~/lib/shared-split-input";
import { api } from "~/trpc/react";
import { readRateText } from "../rate-text";
import { type EntryCatalog, useSettled } from "../shared-ui";
import type { EntryPerson } from "../types";
import type { CustomBy, ExpenseDraft, SplitChoice } from "./draft";

type Category = EntryCatalog["categories"][number];

/**
 * The sheet's state and every edit to it. Picking a category sets Exclude
 * from its default until the switch is touched; a title picks a category
 * from your history (or its keywords) until you pick one yourself; a new
 * project resets the split (its people come in) as today's form does.
 */
export function useExpenseDraft(
	initial: ExpenseDraft,
	o: { you: SplitRef; home: string; categories: readonly Category[] },
) {
	const locale = useLocale();
	const [d, setD] = useState(initial);
	const [ring, setRing] = useState(false);
	const set = useCallback(
		(patch: Partial<ExpenseDraft>) => setD((x) => ({ ...x, ...patch })),
		[],
	);
	const members = splitMembers({
		you: o.you,
		youIncluded: d.youIncluded,
		others: d.others,
	});

	const categoryPatch = (
		x: ExpenseDraft,
		id: string,
	): Partial<ExpenseDraft> => {
		const cat = o.categories.find((c) => c.id === id);
		if (x.excludeTouched || !cat) return { categoryId: id };
		return {
			categoryId: id,
			exclude: cat.excludeByDefault,
			excludeAuto: cat.excludeByDefault,
		};
	};

	const hint = useTitleHint(d, o.categories, (id) => {
		setD((x) =>
			x.categoryTouched || x.categoryId === id
				? x
				: { ...x, ...categoryPatch(x, id) },
		);
		setRing(true);
	});
	useEffect(() => {
		if (!ring) return;
		const t = setTimeout(() => setRing(false), 1500);
		return () => clearTimeout(t);
	}, [ring]);

	const resetSplit = { split: "even" as const, exact: {}, pct: {}, shares: {} };
	return {
		d,
		set,
		ring,
		hint,
		members,
		setAmount: (text: string) => {
			const r = parseMoneyInput(text, locale, d.currency);
			set({ amountText: text, minor: r.ok ? r.minor : null });
		},
		setCurrency: (currency: string) =>
			set({
				currency,
				rateType: null,
				custom: false,
				customText: "",
				customRate: null,
				amountText: "",
				minor: null,
				exact: {},
			}),
		pickCategory: (id: string) =>
			setD((x) => ({ ...x, ...categoryPatch(x, id), categoryTouched: true })),
		pickRate: (type: string) => set({ rateType: type, custom: false }),
		pickCustom: () => set({ custom: true }),
		setCustomText: (text: string) => {
			// A rate, not home money: up to 12 decimals (EUR 1.0834 into USD, anything into JPY).
			const read = readRateText(text, locale);
			set({ customText: read.text, customRate: read.rate });
		},
		toggleYou: () => set({ youIncluded: !d.youIncluded, ...resetSplit }),
		togglePerson: (p: EntryPerson) => {
			const on = d.others.some((x) => splitKey(x) === splitKey(p));
			const others = on
				? d.others.filter((x) => splitKey(x) !== splitKey(p))
				: [...d.others, p];
			const payerGone = on && splitKey(d.paidBy) === splitKey(p);
			set({ others, ...resetSplit, ...(payerGone ? { paidBy: o.you } : {}) });
		},
		setOthers: (others: readonly EntryPerson[]) =>
			set({ others, ...resetSplit }),
		setProject: (
			projectId: string | null,
			people: readonly EntryPerson[],
			currency?: string,
		) =>
			set({
				projectId,
				others: people,
				paidBy: o.you,
				youIncluded: true,
				outsidePayer: null,
				...resetSplit,
				...(currency && !d.minor
					? { currency, rateType: null, custom: false }
					: {}),
				spread: "one",
				exclude: false,
			}),
		setPayer: (ref: SplitRef) => set({ paidBy: ref }),
		setSplit: (split: SplitChoice) => set({ split }),
		setBy: (by: CustomBy) => {
			const pct: Record<string, number> = {};
			const shares: Record<string, number> = {};
			const n = members.length;
			members.forEach((m, i) => {
				// Equal percents that add up to 100 (the last one takes the rest).
				const base = Math.floor(10000 / n) / 100;
				pct[splitKey(m)] =
					i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base;
				shares[splitKey(m)] = 1;
			});
			set({ by, pct, shares, exact: {} });
		},
		setExact: (key: string, minor: number | null) =>
			setD((x) => {
				const exact = { ...x.exact };
				if (minor === null) delete exact[key];
				else exact[key] = minor;
				return { ...x, exact };
			}),
		setPct: (key: string, value: number) =>
			setD((x) => ({ ...x, pct: { ...x.pct, [key]: value } })),
		stepShares: (key: string, step: 1 | -1) =>
			setD((x) => ({
				...x,
				shares: {
					...x.shares,
					[key]: Math.max(1, (x.shares[key] ?? 1) + step),
				},
			})),
		toggleExclude: () =>
			set({ exclude: !d.exclude, excludeTouched: true, excludeAuto: false }),
	};
}

/**
 * "Last time ARS 3,500" and the category from your history for this title
 * (twice or more), else from its keywords. Create only.
 */
function useTitleHint(
	d: ExpenseDraft,
	categories: readonly Category[],
	autoPick: (id: string) => void,
) {
	const title = useSettled(d.title.trim(), 300);
	const creating = d.editing === null;
	const { data } = api.expense.titleSuggestions.useQuery(
		{ query: title },
		{ enabled: creating && title.length >= 2 },
	);
	const match = data?.find(
		(s) => s.title.toLowerCase() === title.toLowerCase(),
	);
	const known = match && match.count >= 2 ? match : null;
	const pick = useRef(autoPick);
	pick.current = autoPick;
	const fromKeywords =
		title.length >= 3
			? predictCategory(title.normalize("NFD").replace(/\p{Diacritic}/gu, ""))
			: null;
	const auto =
		known?.lastCategoryId ??
		categories.find(
			(c) =>
				c.kind === "EXPENSE" &&
				c.name.toLowerCase() === fromKeywords?.toLowerCase(),
		)?.id ??
		null;
	useEffect(() => {
		if (creating && auto && !d.categoryTouched) pick.current(auto);
	}, [creating, auto, d.categoryTouched]);
	return known?.lastAmount != null && known.lastCurrency
		? {
				minor: toMinorUnits(known.lastAmount, known.lastCurrency),
				currency: known.lastCurrency,
			}
		: null;
}
