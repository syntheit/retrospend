"use client";

import {
	Banknote,
	Building2,
	ChartNoAxesCombined,
	Coins,
	CreditCard,
	Landmark,
	type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { CryptoIcon } from "~/components/ui/crypto-icon";
import { useRowDates } from "./dates";
import { usePercent } from "./percent";
import { IconTile, Row, type RowPassThrough, RowSub } from "./row";
import type { AccountKind, AccountVM } from "./types";

const KIND_ICON: Record<AccountKind, LucideIcon> = {
	bank: Landmark,
	cash: Banknote,
	invest: ChartNoAxesCombined,
	crypto: Coins,
	property: Building2,
	liability: CreditCard,
};

/**
 * The sub line. With the Wealth page's detail: the currency code, then how
 * it counts (closed, no rate, a liability's APR, the rate type it is valued
 * at), then the day it changed. Without: when it changed and this month's
 * change (the gallery's anatomy).
 */
function useAccountSub(account: AccountVM) {
	const t = useTranslations("rows.account");
	const { short } = useRowDates();
	const percent = usePercent();
	const updated = t("updated", { date: short(account.updated) });
	const d = account.detail;
	if (!d)
		return [
			updated,
			account.change
				? t("change", { change: percent(account.change, { signed: true }) })
				: null,
		];
	const code = account.amount.currency;
	if (d.closedOn)
		return [code, { shrink: t("closed", { date: short(d.closedOn) }) }];
	if (d.noRate)
		return [
			code,
			{
				shrink: (
					<span className="text-attention-text">
						{t("noRate", { currency: code })}
					</span>
				),
			},
		];
	return [
		code,
		d.apr != null
			? t("apr", { apr: percent(d.apr) })
			: d.valuedAt
				? t("valuedAt", { type: d.valuedAt })
				: null,
		updated,
	];
}

/**
 * AccountRow: a wealth account, its native amount first and the home value
 * under it when the currency differs (Money.pair). Liabilities arrive
 * negative and stay neutral: no meaning color on owing.
 */
export function AccountRow({
	account,
	onOpen,
	actions,
	...rest
}: {
	account: AccountVM;
	onOpen?: () => void;
	actions?: ReactNode;
} & RowPassThrough) {
	const sub = useAccountSub(account);
	const foreign =
		account.home !== undefined &&
		account.home?.currency !== account.amount.currency;
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				foreign ? (
					<Money.pair
						figure={account.figure}
						home={account.home ?? null}
						homeFigure={account.homeFigure}
						original={account.amount}
					/>
				) : (
					<Money figure={account.figure} value={account.amount} />
				)
			}
			lead={
				account.kind === "crypto" ? (
					<IconTile>
						<CryptoIcon
							className="size-5 border-0 bg-transparent"
							currencyCode={account.amount.currency}
						/>
					</IconTile>
				) : (
					<IconTile icon={KIND_ICON[account.kind]} />
				)
			}
			open={onOpen ? { onOpen, label: account.name } : undefined}
			sub={<RowSub parts={sub} />}
			title={account.name}
		/>
	);
}
