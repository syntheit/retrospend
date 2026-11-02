"use client";

import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { useRateFormat } from "~/components/money/use-rate-format";
import { useRowDates } from "~/components/rows/dates";
import { Sheet } from "~/components/ui/sheet";
import type { WealthAccount } from "../types";
import { balanceMinor } from "./balance";
import { RateTypeChips, useRateLabel } from "./rate-type-chips";

/** The amount to start from: the size of the balance (a debt is typed as owed). */
function startText(a: WealthAccount, locale: string) {
	const minor = Math.abs(a.amount.minor);
	return minor ? draftFromMinor(minor, locale, a.amount.currency) : "";
}

/**
 * Update balance: the new balance in the account's currency and, when the
 * currency has several rate types, the type it is valued at from today
 * (earlier days keep theirs: each snapshot stores its own type). No
 * "What this changes" block yet: the mutation has no preview (GAPS, 2D).
 */
export function UpdateBalanceSheet({
	account,
	onOpenChange,
	onSave,
}: {
	account: WealthAccount;
	onOpenChange: (open: boolean) => void;
	onSave: (
		value: { minor: number; currency: string },
		rateType: string | null,
	) => Promise<void>;
}) {
	const t = useTranslations("wealthPage.sheets");
	const locale = useMoneyLocale();
	const { short } = useRowDates();
	const rateLabel = useRateLabel();
	const fmt = useRateFormat();
	const currency = account.amount.currency;
	const [text, setText] = useState(() => startText(account, locale));
	const [type, setType] = useState(account.rateType);
	const [tried, setTried] = useState(false);
	const result = parseMoneyInput(text, locale, currency);
	const home = account.home?.currency ?? null;
	// A type's name always carries its number (R8).
	const named = (key: string | null) => {
		if (!key) return "";
		const label = rateLabel(key);
		return (
			(home
				? fmt.typed(label, currency, home, account.typeRates[key])
				: null) ?? label
		);
	};
	const changed =
		type != null && account.rateType != null && type !== account.rateType;
	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={async () => {
				setTried(true);
				const minor = balanceMinor(result);
				if (minor == null) return false;
				await onSave({ minor, currency }, type);
			}}
			open
			submitLabel={t("update.submit")}
			title={t("update.title")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="min-w-0">
						<div className="text-body text-fg truncate font-semibold">
							{account.name}
						</div>
						<div className="text-fg-3 text-meta">
							{t.rich("update.now", {
								amount: () => (
									<Money
										sign={account.kind === "liability" ? "never" : undefined}
										value={account.amount}
									/>
								),
								date: short(account.updated),
							})}
						</div>
					</div>
				</div>
				<MoneyInput
					autoFocus
					currency={currency}
					onChange={(next) => setText(next)}
					showErrors={tried}
					value={text}
				/>
				{account.home === null ? (
					<p className="text-attention-text text-small">
						{t("noRate", { currency })}
					</p>
				) : null}
				<RateTypeChips
					onChange={setType}
					types={account.rateTypes}
					value={type}
				/>
				{account.rateTypes.length > 1 && type ? (
					<p
						className={
							changed
								? "text-attention-text text-small"
								: "text-fg-2 text-small"
						}
					>
						{changed
							? t("update.rateChange", {
									next: named(type),
									before: named(account.rateType),
								})
							: t("valuedAt", { type: named(type) })}
					</p>
				) : null}
			</div>
		</Sheet>
	);
}
