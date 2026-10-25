"use client";

import type { CurrencyCode } from "@retrospend/domain/currencies";
import { useTranslations } from "next-intl";
import { CurrencyPicker } from "~/components/currency-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PaymentMethodIcon } from "~/components/ui/payment-method-icon";
import { Segmented } from "~/components/ui/segmented";
import {
	getCurrencyForType,
	getIdentifierConfig,
	getMethodType,
	getNetworksForType,
} from "~/lib/payment-method-registry";
import { SelectField } from "../select-field";
import type { Visibility } from "./types";

export type MethodDraft = {
	type: string;
	identifier: string;
	label: string;
	showLabel: boolean;
	currency: string;
	network: string;
	minAmount: string;
	visibility: Visibility;
};

/** Step two: the fields of one payment method. */
export function MethodFields({
	draft,
	onChange,
}: {
	draft: MethodDraft;
	onChange: (patch: Partial<MethodDraft>) => void;
}) {
	const t = useTranslations("settingsPage");
	const def = getMethodType(draft.type);
	const idConfig = getIdentifierConfig(draft.type);
	const networks = getNetworksForType(draft.type);
	const fixedCurrency = getCurrencyForType(draft.type);
	if (!def) return null;
	const multiCurrency =
		def.currencies.includes("*") || (def.currencies.length ?? 0) > 1;
	const fee = (level: string) =>
		level === "low"
			? t("feeLow")
			: level === "medium"
				? t("feeMedium")
				: t("feeHigh");
	const visibility: { value: Visibility; label: string; desc: string }[] = [
		{
			value: "PUBLIC",
			label: t("visibilityPublic"),
			desc: t("visibilityPublicDesc"),
		},
		{
			value: "FRIENDS_ONLY",
			label: t("visibilityContacts"),
			desc: t("visibilityContactsDesc"),
		},
		{
			value: "PAYMENT_ONLY",
			label: t("visibilitySettlement"),
			desc: t("visibilitySettlementDesc"),
		},
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<PaymentMethodIcon size="lg" typeId={draft.type} />
				<div>
					<p className="text-fg text-body font-semibold">{def.name}</p>
					{fixedCurrency && (
						<p className="text-fg-3 text-meta">{fixedCurrency}</p>
					)}
				</div>
			</div>

			{idConfig.type !== "none" && (
				<div className="flex flex-col gap-2">
					<Label htmlFor="pm-identifier">{idConfig.label}</Label>
					<div className="flex gap-2">
						{idConfig.prefix && (
							<span className="rounded-ctl bg-raised text-fg-2 text-small h-ctl flex items-center px-3">
								{idConfig.prefix}
							</span>
						)}
						<Input
							className={idConfig.type === "wallet_address" ? "font-mono" : ""}
							id="pm-identifier"
							maxLength={500}
							onChange={(e) => onChange({ identifier: e.target.value })}
							placeholder={idConfig.placeholder}
							value={draft.identifier}
						/>
					</div>
				</div>
			)}

			{networks.length > 1 && (
				<div className="flex flex-col gap-2">
					<Label htmlFor="pm-network">{t("network")}</Label>
					<SelectField
						id="pm-network"
						onChange={(network) => onChange({ network })}
						options={networks.map((n) => ({
							value: n.id,
							label: `${n.shortName} · ${fee(n.feeLevel)}`,
						}))}
						value={draft.network}
					/>
				</div>
			)}

			{multiCurrency && (
				<div className="flex flex-col gap-2">
					<Label>{t("currency")}</Label>
					<div className="w-32">
						<CurrencyPicker
							onValueChange={(currency) => onChange({ currency })}
							triggerDisplay="code"
							value={
								(draft.currency as CurrencyCode) || ("USD" as CurrencyCode)
							}
						/>
					</div>
				</div>
			)}

			{draft.showLabel ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor="pm-label">{t("displayName")}</Label>
					<Input
						id="pm-label"
						maxLength={100}
						onChange={(e) => onChange({ label: e.target.value })}
						placeholder={def.name}
						value={draft.label}
					/>
				</div>
			) : (
				<div>
					<Button
						kind="ghost"
						onClick={() => onChange({ showLabel: true })}
						size="sm"
						type="button"
					>
						{t("addCustomLabel")}
					</Button>
				</div>
			)}

			<div className="flex flex-col gap-2">
				<Label htmlFor="pm-min">{t("minimumAmountOptional")}</Label>
				<div className="flex items-center gap-2">
					<Input
						className="w-32 tabular-nums"
						id="pm-min"
						min="0"
						onChange={(e) => onChange({ minAmount: e.target.value })}
						step="0.01"
						type="number"
						value={draft.minAmount}
					/>
					{(fixedCurrency || draft.currency) && (
						<span className="text-fg-3 text-small">
							{fixedCurrency || draft.currency}
						</span>
					)}
				</div>
				<p className="text-fg-3 text-meta">{t("minimumAmountHint")}</p>
			</div>

			<div className="flex flex-col gap-2">
				<Label>{t("visibility")}</Label>
				<Segmented
					label={t("visibility")}
					onChange={(v) => onChange({ visibility: v })}
					options={visibility.map(({ value, label }) => ({ value, label }))}
					value={draft.visibility}
				/>
				<p className="text-fg-3 text-meta">
					{visibility.find((o) => o.value === draft.visibility)?.desc}
				</p>
			</div>
		</div>
	);
}
