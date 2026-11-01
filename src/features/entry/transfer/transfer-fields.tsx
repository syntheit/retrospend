"use client";

import {
	ArrowDownToLine,
	ArrowUpFromLine,
	CalendarDays,
	MoreHorizontal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput, MoneyInputRow } from "~/components/money/money-input";
import { AnswerLine, type AnswerPart } from "~/components/ui/answer-line";
import type { DetailTab } from "~/components/ui/detail-pager";
import { Input } from "~/components/ui/input";
import { AccountPills } from "../account-pills";
import { ComposerFrame } from "../composer-frame";
import { useDays } from "../expense/expense-answers";
import { WhenPanel } from "../expense/expense-panels";
import {
	type EntryCatalog,
	Field,
	FieldError,
	RateLine,
	useRateTypeName,
} from "../shared-ui";
import type { useTransfer } from "./use-transfer";

type TabId = "from" | "to" | "when" | "more";

/**
 * Transfer and Exchange on the composer frame (design D): You send and, when
 * the currencies differ, You receive with the rate they make on the left;
 * the tabs From, To, When and More (Note, Bank fee) on the right. The money
 * layer (useTransfer, the preview, save and Undo) is the caller's.
 */
export function TransferFields({
	x,
	catalog,
	today,
	tried,
	changes,
}: {
	x: ReturnType<typeof useTransfer>;
	catalog: EntryCatalog;
	today: string;
	tried: boolean;
	changes: React.ReactNode;
}) {
	const t = useTranslations("entry.transfer");
	const name = useRateTypeName();
	const { days, dayLabel } = useDays(today);
	const [tab, setTab] = useState<TabId>("from");
	const home = catalog.homeCurrency;
	const v = x.preview?.value ?? null;
	const ref = v?.referenceRateType ? name(v.referenceRateType) : "";
	const vs = v?.vsReference;
	const tip = (label: string, key: number) =>
		t("tabs.tip", { name: label, key });

	const tabs: (DetailTab & { id: TabId })[] = [
		{
			id: "from",
			label: t("tabs.from"),
			icon: <ArrowUpFromLine aria-hidden="true" />,
			tip: tip(t("tabs.from"), 1),
			panel: (
				<AccountPills
					label={t("from")}
					none={t("notTracked")}
					onChange={x.setFrom}
					places={catalog.places}
					value={x.from}
				/>
			),
		},
		{
			id: "to",
			label: t("tabs.to"),
			icon: <ArrowDownToLine aria-hidden="true" />,
			tip: tip(t("tabs.to"), 2),
			panel: (
				<div className="flex flex-col gap-2">
					<AccountPills
						label={t("to")}
						none={t("notTracked")}
						onChange={x.setTo}
						places={catalog.places}
						value={x.to}
					/>
					{tried && x.errors.same ? (
						<FieldError text={t("error.same")} />
					) : null}
				</div>
			),
		},
		{
			id: "when",
			label: t("tabs.when"),
			icon: <CalendarDays aria-hidden="true" />,
			tip: tip(t("tabs.when"), 3),
			dot: x.date !== today,
			panel: (
				<WhenPanel
					date={x.date}
					dayLabel={dayLabel}
					days={days}
					onDate={x.setDate}
					today={today}
				/>
			),
		},
		{
			id: "more",
			label: t("tabs.more"),
			icon: <MoreHorizontal aria-hidden="true" />,
			tip: tip(t("tabs.more"), 4),
			dot: !!x.note || !!x.fee.minor,
			panel: (
				<div className="flex flex-col gap-4">
					<Field htmlFor="transfer-note" label={t("note")}>
						<Input
							id="transfer-note"
							onChange={(e) => x.setNote(e.target.value)}
							value={x.note}
						/>
					</Field>
					<Field label={t("bankFee")}>
						<MoneyInput
							currency={x.fromCur}
							onChange={x.setFee}
							value={x.fee.text}
						/>
					</Field>
				</div>
			),
		},
	];

	const parts: AnswerPart[] = [
		{
			id: "route",
			text: `${x.fromPlace?.name ?? t("notTracked")} → ${x.toPlace?.name ?? t("notTracked")}`,
			onSelect: () => setTab("from"),
		},
		{ id: "when", text: dayLabel(x.date), onSelect: () => setTab("when") },
		...(x.note
			? [{ id: "note", text: t("note"), onSelect: () => setTab("more") }]
			: []),
		...(x.fee.minor
			? [{ id: "fee", text: t("bankFee"), onSelect: () => setTab("more") }]
			: []),
	];

	return (
		<ComposerFrame
			active={tab}
			changes={changes}
			entry={
				<>
					<Field label={t("youSend")}>
						<MoneyInput
							autoFocus
							currency={x.fromCur}
							onChange={x.setOut}
							showErrors={tried}
							value={x.out.text}
						/>
					</Field>
					{x.exchange ? (
						<Field label={t("youReceive")}>
							<MoneyInput
								currency={x.toCur}
								onChange={x.setIn}
								rows={
									v?.rate ? (
										// The rate the two typed amounts make, inside the field as Add expense shows its rate.
										<MoneyInputRow>
											<span data-testid="transfer-rate">
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
											</span>
										</MoneyInputRow>
									) : undefined
								}
								showErrors={tried}
								value={x.inn.text}
							/>
						</Field>
					) : null}
					{tried && x.errors.amount ? (
						<FieldError text={t("error.amount")} />
					) : null}
					{tried && x.exchange && x.errors.both ? (
						<FieldError text={t("error.both")} />
					) : null}
					<AnswerLine parts={parts} />
				</>
			}
			label={t("tabs.label")}
			onActive={setTab}
			tabs={tabs}
		/>
	);
}
