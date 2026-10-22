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
	const t = useTranslations("rows.account");
	const { short } = useRowDates();
	const percent = usePercent();
	const foreign =
		account.home !== undefined &&
		account.home?.currency !== account.amount.currency;
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				foreign ? (
					<Money.pair home={account.home ?? null} original={account.amount} />
				) : (
					<Money value={account.amount} />
				)
			}
			lead={<IconTile icon={KIND_ICON[account.kind]} />}
			open={onOpen ? { onOpen, label: account.name } : undefined}
			sub={
				<RowSub
					parts={[
						t("updated", { date: short(account.updated) }),
						account.change
							? t("change", {
									change: percent(account.change, { signed: true }),
								})
							: null,
					]}
				/>
			}
			title={account.name}
		/>
	);
}
