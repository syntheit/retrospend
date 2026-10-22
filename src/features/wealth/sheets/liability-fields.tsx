"use client";

import { parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MoneyValue } from "~/components/money/format";
import { MoneyInput } from "~/components/money/money-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { WealthAccount } from "../types";

export type LiabilityState = ReturnType<typeof useLiability>;

export function useLiability(account: WealthAccount | null) {
	const [apr, setApr] = useState(
		account?.apr != null ? String(account.apr) : "",
	);
	const [minimum, setMinimum] = useState("");
	const [due, setDue] = useState("");
	return { apr, setApr, minimum, setMinimum, due, setDue };
}

/** A typed rate or day: digits with one decimal mark; null when empty or not a number. */
function readNumber(text: string): number | null {
	const clean = text.trim().replace(",", ".").replace(/%$/, "");
	if (!clean) return null;
	const n = Number(clean);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The liability terms for the save. Minimum payment and due day are only
 * asked when adding: today's dashboard read does not return them, so an
 * edit leaves them as they are (GAPS).
 */
export function readLiability(
	s: LiabilityState,
	debt: boolean,
	currency: string,
	locale: string,
	isNew: boolean,
): {
	apr: number | null;
	minimumPayment: MoneyValue | null;
	dueDay: number | null;
} {
	if (!debt) return { apr: null, minimumPayment: null, dueDay: null };
	const min = isNew ? parseMoneyInput(s.minimum, locale, currency) : null;
	const day = isNew ? readNumber(s.due) : null;
	return {
		apr: readNumber(s.apr),
		minimumPayment: min?.ok ? { minor: min.minor, currency } : null,
		dueDay:
			day != null && Number.isInteger(day) && day >= 1 && day <= 31
				? day
				: null,
	};
}

export function LiabilityFields({
	state,
	currency,
	isNew,
}: {
	state: LiabilityState;
	currency: string;
	isNew: boolean;
}) {
	const t = useTranslations("wealthPage.sheets.account");
	return (
		<div className="grid grid-cols-2 gap-3">
			<div className="flex flex-col gap-1">
				<Label htmlFor="acct-apr">{t("apr")}</Label>
				<Input
					id="acct-apr"
					inputMode="decimal"
					onChange={(e) => state.setApr(e.target.value)}
					value={state.apr}
				/>
			</div>
			{isNew ? (
				<div className="flex flex-col gap-1">
					<Label htmlFor="acct-due">{t("dueDay")}</Label>
					<Input
						id="acct-due"
						inputMode="numeric"
						onChange={(e) => state.setDue(e.target.value)}
						value={state.due}
					/>
				</div>
			) : null}
			{isNew ? (
				<div className="col-span-2 flex flex-col gap-1">
					<Label htmlFor="acct-min">{t("minimum")}</Label>
					<MoneyInput
						currency={currency}
						id="acct-min"
						onChange={(next) => state.setMinimum(next)}
						value={state.minimum}
					/>
				</div>
			) : null}
		</div>
	);
}
