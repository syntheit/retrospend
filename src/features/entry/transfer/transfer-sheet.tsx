"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { ChangesBlock } from "../changes";
import { ModeSwitch } from "../mode-switch";
import { type EntryCatalog, useEntryCatalog } from "../shared-ui";
import type { EntryCarry, EntryMode } from "../types";
import { TransferFields } from "./transfer-fields";
import { useTransfer } from "./use-transfer";

export function TransferSheet({
	fromAccountId,
	carry,
	onClose,
	onMode,
}: {
	fromAccountId?: string;
	carry?: EntryCarry;
	onClose: () => void;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	const t = useTranslations("entry.transfer");
	const catalog = useEntryCatalog();
	if (!catalog.data)
		return (
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={(o) => !o && onClose()}
				open
				title={t("titleTransfer")}
			>
				<Skeleton className="h-40 w-full" />
			</Sheet>
		);
	return (
		<TransferForm
			carry={carry}
			catalog={catalog.data}
			fromAccountId={fromAccountId}
			onClose={onClose}
			onMode={onMode}
		/>
	);
}

/**
 * Transfer or Exchange: the title follows what it does; the button says it
 * ("Buy USD", "Sell USD"). The exchange result against the reference rate
 * is in net worth, never spending (MONEY-MOVES §2.4).
 */
function TransferForm({
	catalog,
	fromAccountId,
	carry,
	onClose,
	onMode,
}: {
	catalog: EntryCatalog;
	fromAccountId?: string;
	carry?: EntryCarry;
	onClose: () => void;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	const t = useTranslations("entry.transfer");
	const tc = useTranslations("entry.changes");
	const locale = useMoneyLocale();
	const toast = useToast();
	const x = useTransfer(catalog, fromAccountId, carry);
	const [tried, setTried] = useState(false);
	const home = catalog.homeCurrency;
	const v = x.preview?.value ?? null;
	const verb = !x.exchange
		? t("save")
		: x.fromCur === home
			? t("buy", { currency: x.toCur })
			: x.toCur === home
				? t("sell", { currency: x.fromCur })
				: t("exchange");
	const submit = async () => {
		setTried(true);
		if (!x.valid) return false;
		const r = await x.save();
		const words = {
			from: x.fromPlace?.name ?? t("notTracked"),
			to: x.toPlace?.name ?? t("notTracked"),
		};
		const msg = !x.exchange
			? t("toast.moved", {
					...words,
					amount: formatMoney(r.value.from, { locale }),
				})
			: x.fromCur === home
				? t("toast.bought", {
						...words,
						amount: formatMoney(r.value.to, { locale }),
					})
				: t("toast.sold", {
						...words,
						amount: formatMoney(r.value.from, { locale }),
					});
		toast.saved(msg, { undo: () => x.undo(r.value.transferId) });
	};
	return (
		<Sheet
			className="md:h-150 md:max-w-4xl"
			detent="large"
			headerSlot={
				<ModeSwitch carry={{ minor: x.out.minor, currency: x.fromCur, date: x.date, note: x.note }} mode="transfer" onMode={onMode} />
			}
			headerSubmit={verb}
			onOpenChange={(o) => !o && onClose()}
			onSubmit={submit}
			open
			submitLabel={verb}
			title={x.exchange ? t("titleExchange") : t("titleTransfer")}
			wide
		>
			<TransferFields
				catalog={catalog}
				changes={
					<>
						<BudgetLine budget={v?.budget ?? null} />
						<ChangesBlock
							cannot={x.valid ? x.previewError : null}
							diff={x.preview}
							empty={tc("emptyAmount")}
							hide={["accounts.balance"]}
							loading={x.previewLoading}
							rows={v?.accounts.map((a) => (
								<div
									className="flex min-h-6 items-baseline justify-between gap-3 text-small"
									key={a.accountId}
								>
									<span className="text-fg-2">{a.name}</span>
									<span className="flex items-baseline gap-2 text-fg-3">
										<Money value={a.before} />
										{"→ "}
										<Money
											className="text-fg"
											figure={`preview.account.${a.accountId}.after`}
											value={a.after}
										/>
									</span>
								</div>
							))}
						/>
					</>
				}
				today={dayKey(new Date())}
				tried={tried}
				x={x}
			/>
		</Sheet>
	);
}

type Budget = NonNullable<
	ReturnType<typeof useTransfer>["preview"]
>["value"]["budget"];

/** Whether the move leaves or enters your budget, and by how much (MONEY-MOVES §2.1). */
function BudgetLine({ budget }: { budget: Budget | null }) {
	const t = useTranslations("entry.transfer");
	if (!budget || (budget.effect !== "leaves" && budget.effect !== "enters"))
		return null;
	const amount = { minor: budget.minor, currency: budget.currency };
	return (
		<p className="text-fg-2 text-small">
			{t.rich(budget.effect, { amount: () => <Money value={amount} /> })}
		</p>
	);
}
