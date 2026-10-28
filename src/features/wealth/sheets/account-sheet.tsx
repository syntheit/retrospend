"use client";

import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Sheet } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import type { AssetTypeKey, WealthAccount } from "../types";
import type { AccountDraft } from "../use-account-actions";
import { balanceMinor } from "./balance";
import {
	aprInvalid,
	LiabilityFields,
	readLiability,
	useLiability,
} from "./liability-fields";
import { RateTypeChips } from "./rate-type-chips";

const TYPES: AssetTypeKey[] = [
	"CASH",
	"INVESTMENT",
	"CRYPTO",
	"REAL_ESTATE",
	"VEHICLE",
	"LIABILITY_LOAN",
	"LIABILITY_CREDIT_CARD",
	"LIABILITY_MORTGAGE",
];

const isLiability = (type: AssetTypeKey) => type.startsWith("LIABILITY_");

/** USD is the rate table's base: it always has a value. Others need a row. */
const hasRate = (currency: string, rateTypes: Record<string, string[]>) =>
	currency === "USD" || (rateTypes[currency]?.length ?? 0) > 0;

/**
 * Add account / Edit account: name, type, currency and balance, the rate
 * type when the currency has several, liability terms and Liquid. Saves are
 * today's createAsset / updateAsset (no preview yet: GAPS, 2D).
 */
export function AccountSheet({
	account,
	home,
	rateTypes,
	onOpenChange,
	onSave,
}: {
	/** Null adds a new account. */
	account: WealthAccount | null;
	home: string;
	rateTypes: Record<string, string[]>;
	onOpenChange: (open: boolean) => void;
	onSave: (draft: AccountDraft) => Promise<void>;
}) {
	const t = useTranslations("wealthPage.sheets");
	const tt = useTranslations("wealthPage.types");
	const locale = useMoneyLocale();
	const [name, setName] = useState(account?.name ?? "");
	const [type, setType] = useState<AssetTypeKey>(account?.type ?? "CASH");
	const [currency, setCurrency] = useState(account?.amount.currency ?? home);
	const [text, setText] = useState(() =>
		account?.amount.minor
			? draftFromMinor(Math.abs(account.amount.minor), locale, currency)
			: "",
	);
	const [liquid, setLiquid] = useState(account ? account.liquid : true);
	const types = currency === home ? [] : (rateTypes[currency] ?? []);
	const [rateType, setRateType] = useState<string | null>(
		account?.rateType ?? null,
	);
	const liability = useLiability(account);
	const [tried, setTried] = useState(false);
	const result = parseMoneyInput(text, locale, currency);
	// A custom rate counts as a rate while the currency stays the same.
	const rated =
		hasRate(currency, rateTypes) ||
		(account?.valuation.customRate != null &&
			currency === account.amount.currency);
	const debt = isLiability(type);

	const submit = async () => {
		setTried(true);
		const minor = balanceMinor(result, !account);
		if (!name.trim() || minor == null || !rated) return false;
		if (debt && aprInvalid(liability)) return false;
		await onSave({
			name: name.trim(),
			type,
			balance: { minor, currency },
			rateType: types.length > 1 ? (rateType ?? null) : null,
			liquid: !debt && liquid,
			...readLiability(liability, debt, currency, locale, !account),
		});
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitDisabled={!rated}
			submitLabel={account ? t("account.save") : t("account.add")}
			title={account ? t("account.editTitle") : t("account.addTitle")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="acct-name">{t("account.name")}</Label>
					<Input
						aria-invalid={tried && !name.trim() ? true : undefined}
						autoFocus
						id="acct-name"
						onChange={(e) => setName(e.target.value)}
						placeholder={t("account.namePlaceholder")}
						value={name}
					/>
					{tried && !name.trim() ? (
						<span className="text-danger text-meta" role="alert">
							{t("account.nameMissing")}
						</span>
					) : null}
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="acct-type">{t("account.type")}</Label>
					<Select
						onValueChange={(v) => setType(v as AssetTypeKey)}
						value={type}
					>
						<SelectTrigger className="w-full" id="acct-type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TYPES.map((k) => (
								<SelectItem key={k} value={k}>
									{tt(k)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="acct-balance">
						{debt ? t("account.owed") : t("account.balance")}
					</Label>
					<MoneyInput
						currency={currency}
						id="acct-balance"
						onChange={(next) => setText(next)}
						onCurrencyChange={(code) => {
							setCurrency(code);
							setRateType(
								code === account?.amount.currency
									? (account?.rateType ?? null)
									: null,
							);
						}}
						showErrors={tried}
						value={text}
					/>
					{rated ? null : (
						<span className="text-attention-text text-small">
							{t("account.noRate", { currency })}
						</span>
					)}
				</div>
				<RateTypeChips onChange={setRateType} types={types} value={rateType} />
				{debt ? (
					<LiabilityFields
						currency={currency}
						isNew={!account}
						showErrors={tried}
						state={liability}
					/>
				) : (
					<div className="min-h-ctl flex items-center justify-between gap-3">
						<Label htmlFor="acct-liquid">{t("account.liquid")}</Label>
						<Switch
							checked={liquid}
							id="acct-liquid"
							onCheckedChange={setLiquid}
						/>
					</div>
				)}
			</div>
		</Sheet>
	);
}
