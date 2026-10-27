"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { minorOf } from "~/components/money/money-cell";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { DateField } from "~/components/pickers/date-field";
import type { IsoDate } from "~/components/pickers/dates";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Field } from "~/features/entry/shared-ui";
import type { RouterInputs } from "~/trpc/react";
import type { EnvelopeRow } from "./use-month";

export type TargetKind = "MONTHLY" | "BILL" | "SAVINGS" | "NONE";
type Repeat = "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONCE";
export type TargetInput = NonNullable<
	RouterInputs["envelope"]["setTarget"]["target"]
>;

type Initial = Pick<EnvelopeRow, "kind" | "target">;

/** A typed amount as minor units, or null while empty or unreadable. */
function useText(initialMinor: number | null, currency: string) {
	const locale = useMoneyLocale();
	const [text, setText] = useState(() =>
		initialMinor && initialMinor > 0
			? draftFromMinor(initialMinor, locale, currency)
			: "",
	);
	return {
		text,
		set: setText,
		minor: currency ? minorOf(text, locale, currency) : null,
	};
}

/**
 * What the person typed for an envelope's target (SPEC §5.4): the kind and
 * its fields. `input` is the write the server previews: null while the form
 * is not a complete target yet. Every figure shown is typed, never computed.
 */
export function useTargetDraft(
	currency: string,
	today: IsoDate,
	initial: Initial | null,
	defaultKind: TargetKind = "MONTHLY",
) {
	const target = initial?.target ?? null;
	// A foreign target stays in its own currency as typed (D25).
	const own = target?.foreign?.currency ?? currency;
	const shown = target?.foreign ?? target?.amount ?? null;
	const [kind, setKind] = useState<TargetKind>(initial?.kind ?? defaultKind);
	const amount = useText(shown?.minor ?? null, own);
	const [mode, setMode] = useState<"REFILL" | "SET_ASIDE">(
		target?.mode ?? "REFILL",
	);
	const [cadence, setCadence] = useState<"MONTH" | "WEEK">(
		target?.cadence ?? "MONTH",
	);
	const [due, setDue] = useState<IsoDate | null>(
		(target?.dueDate as IsoDate | null) ?? null,
	);
	const [repeat, setRepeat] = useState<Repeat>("MONTHLY");
	const monthly = useText(null, own);
	const follows = target?.liabilityId ?? null;
	const changedKind = initial ? kind !== initial.kind : true;

	let input: TargetInput | null = null;
	if (kind === "MONTHLY" && amount.minor !== null)
		input = {
			kind: "MONTHLY",
			amountMinor: amount.minor,
			mode,
			cadence,
			...(own !== currency ? { currency: own } : {}),
		};
	else if (kind === "BILL" && follows && !changedKind)
		input = { kind: "BILL_LIABILITY", liabilityId: follows };
	else if (kind === "BILL" && amount.minor && due)
		input = {
			kind: "BILL",
			amountMinor: amount.minor,
			dueDate: due,
			repeat: repeat === "ONCE" ? null : repeat,
			...(own !== currency ? { currency: own } : {}),
		};
	else if (
		kind === "SAVINGS" &&
		[amount.minor, due, monthly.minor].filter(Boolean).length >= 2
	)
		input = {
			kind: "SAVINGS",
			...(amount.minor ? { amountMinor: amount.minor } : {}),
			...(due ? { dueDate: due } : {}),
			...(monthly.minor ? { monthlyMinor: monthly.minor } : {}),
			...(own !== currency ? { currency: own } : {}),
		};
	const complete = kind === "NONE" || input !== null;
	return {
		kind,
		setKind,
		amount,
		mode,
		setMode,
		cadence,
		setCadence,
		due,
		setDue,
		repeat,
		setRepeat,
		monthly,
		today,
		currency: own,
		follows,
		/** The target to send: null means no target (kind NONE). */
		input: kind === "NONE" ? null : input,
		complete,
	};
}

export type TargetDraft = ReturnType<typeof useTargetDraft>;

/** The target's kind and the fields that kind needs. */
export function TargetFields({ draft }: { draft: TargetDraft }) {
	const t = useTranslations("budgetSheets.target");
	const f = useDateFormat();
	const day = (id: string, label: string, value: IsoDate | null) => (
		<DateField
			display={f.medium}
			edit={f.field}
			id={id}
			label={label}
			onChange={draft.setDue}
			placeholder={f.medium(draft.today)}
			read={f.read}
			value={value}
		/>
	);
	return (
		<div className="flex flex-col gap-4">
			<Field label={t("kind")}>
				<Segmented
					label={t("kind")}
					onChange={draft.setKind}
					options={[
						{ value: "MONTHLY", label: t("monthly") },
						{ value: "BILL", label: t("bill") },
						{ value: "SAVINGS", label: t("savings") },
						{ value: "NONE", label: t("none") },
					]}
					value={draft.kind}
				/>
			</Field>
			{draft.kind === "NONE" ? (
				<p className="text-fg-3 text-small">{t("noneNote")}</p>
			) : null}
			{draft.kind === "BILL" && draft.follows ? (
				<Notice tone="info">{t("followsDebt")}</Notice>
			) : null}
			{draft.kind === "MONTHLY" ? (
				<>
					<Field label={t("amount")}>
						<MoneyInput
							currency={draft.currency}
							onChange={(text) => draft.amount.set(text)}
							value={draft.amount.text}
						/>
					</Field>
					<Segmented
						label={t("how")}
						onChange={draft.setMode}
						options={[
							{ value: "REFILL", label: t("refill") },
							{ value: "SET_ASIDE", label: t("setAside") },
						]}
						value={draft.mode}
					/>
					<p className="text-fg-3 text-small">{t(`about.${draft.mode}`)}</p>
					<Segmented
						label={t("cadence")}
						onChange={draft.setCadence}
						options={[
							{ value: "MONTH", label: t("eachMonth") },
							{ value: "WEEK", label: t("eachWeek") },
						]}
						value={draft.cadence}
					/>
				</>
			) : null}
			{draft.kind === "BILL" && !draft.follows ? (
				<>
					<Field label={t("amount")}>
						<MoneyInput
							currency={draft.currency}
							onChange={(text) => draft.amount.set(text)}
							value={draft.amount.text}
						/>
					</Field>
					{day("target-due", t("due"), draft.due)}
					<Field label={t("repeats")}>
						<Select
							kit
							onValueChange={(v) => draft.setRepeat(v as typeof draft.repeat)}
							value={draft.repeat}
						>
							<SelectTrigger aria-label={t("repeats")} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(["MONTHLY", "QUARTERLY", "YEARLY", "ONCE"] as const).map(
									(r) => (
										<SelectItem key={r} value={r}>
											{t(`repeat.${r}`)}
										</SelectItem>
									),
								)}
							</SelectContent>
						</Select>
					</Field>
				</>
			) : null}
			{draft.kind === "SAVINGS" ? (
				<>
					<p className="text-fg-3 text-small">{t("savingsNote")}</p>
					<Field label={t("goal")}>
						<MoneyInput
							currency={draft.currency}
							onChange={(text) => draft.amount.set(text)}
							value={draft.amount.text}
						/>
					</Field>
					{day("target-by", t("by"), draft.due)}
					<Field label={t("perMonth")}>
						<MoneyInput
							currency={draft.currency}
							onChange={(text) => draft.monthly.set(text)}
							value={draft.monthly.text}
						/>
					</Field>
				</>
			) : null}
		</div>
	);
}
