"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { AccountTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import type { MoneyValue } from "~/components/money/format";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { rateInput } from "./rate-input";
import type { AssetTypeKey, WealthAccount, WealthView } from "./types";

export type SheetState =
	| { kind: "update" | "edit" | "close"; account: WealthAccount }
	| { kind: "add" }
	| null;

/** What the account sheet saves; amounts are Money from the MoneyInput. */
export type AccountDraft = {
	name: string;
	type: AssetTypeKey;
	balance: MoneyValue;
	rateType: string | null;
	liquid: boolean;
	apr: number | null;
	minimumPayment: MoneyValue | null;
	dueDay: number | null;
};

/**
 * The API takes major units as a number: the exact decimal text of the
 * Money, read as a number (a parse, not arithmetic).
 */
const major = (m: MoneyValue) => Number(fromMinor(m));

/**
 * A liability shows negative but is written back with the sign it was
 * stored with (the forms store debt positive, older data negative).
 */
const stored = (a: WealthAccount, m: MoneyValue): MoneyValue =>
	a.kind === "liability"
		? { minor: Math.abs(m.minor) * a.storedSign, currency: m.currency }
		: m;

/**
 * Every account mutation, with its toast and Undo (R15). Today's wealth
 * mutations have no preview yet (GAPS: 2D adds them). After each write the
 * server view is read again (router.refresh), so every figure stays the
 * server's.
 */
export function useAccountActions(
	view: WealthView,
	open: (s: SheetState) => void,
) {
	const t = useTranslations("wealthPage.toast");
	const toast = useToast();
	const router = useRouter();
	const refresh = () => router.refresh();
	const opts = { onSuccess: refresh };
	const update = api.wealth.updateAssetBalance.useMutation(opts);
	const edit = api.wealth.updateAsset.useMutation(opts);
	const create = api.wealth.createAsset.useMutation(opts);
	const close = api.wealth.closeAsset.useMutation(opts);
	const reopen = api.wealth.reopenAsset.useMutation(opts);
	const remove = api.wealth.deleteAssetPermanently.useMutation(opts);

	const byId = useMemo(() => {
		const all = [...view.groups.flatMap((g) => g.accounts), ...view.closed];
		return new Map(all.map((a) => [a.id, a]));
	}, [view]);
	const find = (target: AccountTarget) => byId.get(target.id);

	const handlers: ActionHandlers<AccountTarget> = {
		updateBalance: (x) => {
			const a = find(x);
			if (a) open({ kind: "update", account: a });
		},
		edit: (x) => {
			const a = find(x);
			if (a) open({ kind: "edit", account: a });
		},
		close: (x) => {
			const a = find(x);
			if (a) open({ kind: "close", account: a });
		},
		reopen: (x) =>
			reopen
				.mutateAsync({ id: x.id })
				.then(() =>
					toast.saved(t("reopened", { name: x.name }), {
						undo: () => close.mutateAsync({ id: x.id }),
					}),
				)
				.catch(() => toast.failed(t("failed"))),
		delete: (x) =>
			remove
				.mutateAsync({ id: x.id })
				.then(() => toast.saved(t("deleted", { name: x.name })))
				.catch(() => toast.failed(t("failed"))),
	};

	return {
		handlers,
		async updateBalance(
			a: WealthAccount,
			value: MoneyValue,
			rateType: string | null,
		) {
			const changed =
				rateType && rateType !== a.rateType ? rateType : undefined;
			await update.mutateAsync({
				assetId: a.id,
				newBalance: major(stored(a, value)),
				exchangeRateType: changed,
			});
			toast.saved(t("updated", { name: a.name }), {
				undo: () =>
					update.mutateAsync({
						assetId: a.id,
						newBalance: major(stored(a, a.amount)),
						// Back to the stored valuation (a custom rate with its rate).
						...(changed ? rateInput(a, a.amount.currency, null) : {}),
					}),
			});
		},
		async closeAccount(a: WealthAccount) {
			await close.mutateAsync({ id: a.id });
			toast.saved(t("closed", { name: a.name }), {
				undo: () => reopen.mutateAsync({ id: a.id }),
			});
		},
		async saveAccount(a: WealthAccount | null, d: AccountDraft) {
			const input = {
				name: d.name,
				type: d.type,
				currency: d.balance.currency,
				balance: major(a ? stored(a, d.balance) : d.balance),
				...rateInput(a, d.balance.currency, d.rateType),
				isLiquid: d.liquid,
				interestRate: d.apr ?? undefined,
				minimumPayment: d.minimumPayment ? major(d.minimumPayment) : undefined,
				dueDate: d.dueDay ?? undefined,
			};
			if (!a) {
				const made = await create.mutateAsync(input);
				toast.saved(t("added", { name: d.name }), {
					undo: () => remove.mutateAsync({ id: made.id }),
				});
				return;
			}
			await edit.mutateAsync({ id: a.id, ...input });
			toast.saved(t("saved", { name: d.name }), {
				undo: () =>
					edit.mutateAsync({
						id: a.id,
						name: a.name,
						type: a.type,
						currency: a.amount.currency,
						balance: major(stored(a, a.amount)),
						...rateInput(a, a.amount.currency, null),
						isLiquid: a.liquid,
						interestRate: a.apr ?? undefined,
					}),
			});
		},
	};
}
