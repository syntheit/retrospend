"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { DatePicker } from "~/components/pickers/date-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { dayKey } from "@retrospend/domain/time-zone";
import { ChangesBlock } from "../changes";
import { PlaceSelect } from "../place-select";
import {
	type EntryCatalog,
	Field,
	FieldError,
	RateLine,
	useEntryCatalog,
	useRateTypeName,
} from "../shared-ui";
import { useTransfer } from "./use-transfer";

export function TransferSheet({
	fromAccountId,
	onClose,
}: {
	fromAccountId?: string;
	onClose: () => void;
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
			catalog={catalog.data}
			fromAccountId={fromAccountId}
			onClose={onClose}
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
	onClose,
}: {
	catalog: EntryCatalog;
	fromAccountId?: string;
	onClose: () => void;
}) {
	const t = useTranslations("entry.transfer");
	const tc = useTranslations("entry.changes");
	const name = useRateTypeName();
	const locale = useLocale();
	const toast = useToast();
	const x = useTransfer(catalog, fromAccountId);
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
	const ref = v?.referenceRateType ? name(v.referenceRateType) : "";
	const vs = v?.vsReference;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={submit}
			open
			submitLabel={verb}
			title={x.exchange ? t("titleExchange") : t("titleTransfer")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Field label={t("from")}>
						<PlaceSelect
							label={t("from")}
							none={t("notTracked")}
							onChange={x.setFrom}
							places={catalog.places}
							value={x.from}
						/>
					</Field>
					<MoneyInput
						autoFocus
						currency={x.fromCur}
						onChange={x.setOut}
						showErrors={tried}
						value={x.out.text}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Field
						error={tried && x.errors.same ? t("error.same") : null}
						label={t("to")}
					>
						<PlaceSelect
							label={t("to")}
							none={t("notTracked")}
							onChange={x.setTo}
							places={catalog.places}
							value={x.to}
						/>
					</Field>
					{x.exchange ? (
						<MoneyInput
							currency={x.toCur}
							onChange={x.setIn}
							showErrors={tried}
							value={x.inn.text}
						/>
					) : (
						<span className="flex h-ctl items-center text-fg-3 text-small">
							{t("sameAmount")}
						</span>
					)}
				</div>
				{tried && x.errors.amount ? (
					<FieldError text={t("error.amount")} />
				) : null}
				{tried && x.exchange && x.errors.both ? (
					<FieldError text={t("error.both")} />
				) : null}
				{x.exchange ? (
					<p className="text-fg-2 text-small" data-testid="transfer-rate">
						{v?.rate ? (
							<>
								<RateLine rate={v.rate} />
								{vs && ref && v.reference ? (
									<>
										{" · "}
										{ref} <Money value={v.reference.value} />
										{" · "}
										{vs.minor === 0
											? t("vsSame", { type: ref })
											: t.rich(
													vs.minor < 0 === (x.fromCur === home)
														? "vsMore"
														: "vsLess",
													{
														type: ref,
														amount: () => (
															<Money
																figure="preview.transfer.vsReference"
																value={{
																	minor: Math.abs(vs.minor),
																	currency: vs.currency,
																}}
															/>
														),
													},
												)}
									</>
								) : null}
							</>
						) : (
							t("rateHint")
						)}
					</p>
				) : null}
				{x.feeOpen ? (
					<Field
						label={`${t("fee")} (${t("feeHint", { account: x.fromPlace?.name ?? t("notTracked") })})`}
					>
						<MoneyInput
							currency={x.fromCur}
							onChange={x.setFee}
							value={x.fee.text}
						/>
					</Field>
				) : (
					<div>
						<Button kind="ghost" onClick={x.openFee} size="sm">
							<Plus aria-hidden="true" />
							{t("feeAdd")}
						</Button>
					</div>
				)}
				<div className="grid gap-4 md:grid-cols-2">
					<Field label={t("date")}>
						<DatePicker
							onChange={x.setDate}
							today={dayKey(new Date())}
							value={x.date}
						/>
					</Field>
					<Field htmlFor="transfer-note" label={t("note")}>
						<Input
							id="transfer-note"
							onChange={(e) => x.setNote(e.target.value)}
							placeholder={t("notePlaceholder")}
							value={x.note}
						/>
					</Field>
				</div>
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
			</div>
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
