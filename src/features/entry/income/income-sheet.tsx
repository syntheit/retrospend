"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "~/components/money/format";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { DatePicker } from "~/components/pickers/date-picker";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { useToast } from "~/components/ui/toast";
import { dayKey } from "@retrospend/domain/time-zone";
import { ChangesBlock } from "../changes";
import { PlaceSelect } from "../place-select";
import {
	type EntryCatalog,
	Field,
	useEntryCatalog,
	useRateTypeName,
} from "../shared-ui";
import { PlanBlock } from "./plan-block";
import { SourceField } from "./source-field";
import { useIncome } from "./use-income";

/** Add income: its own sheet (owner N71), Use my plan as the primary path (N72). */
export function IncomeSheet({
	accountId,
	onClose,
}: {
	accountId?: string;
	onClose: () => void;
}) {
	const t = useTranslations("entry.income");
	const catalog = useEntryCatalog();
	if (!catalog.data)
		return (
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={(o) => !o && onClose()}
				open
				title={t("title")}
			>
				<Skeleton className="h-40 w-full" />
			</Sheet>
		);
	return (
		<IncomeForm
			accountId={accountId}
			catalog={catalog.data}
			onClose={onClose}
		/>
	);
}

function IncomeForm({
	catalog,
	accountId,
	onClose,
}: {
	catalog: EntryCatalog;
	accountId?: string;
	onClose: () => void;
}) {
	const t = useTranslations("entry.income");
	const tc = useTranslations("entry.changes");
	const name = useRateTypeName();
	const toast = useToast();
	const locale = useLocale();
	const x = useIncome(catalog, accountId);
	const { d } = x;
	const [tried, setTried] = useState(false);
	const cats = catalog.categories.filter((c) => c.kind === "INCOME");
	const err = (k: keyof typeof x.errors) => tried && x.errors[k];
	const picked =
		x.rates?.options.find((o) => o.rateType === x.rateType) ?? null;

	const submit = async () => {
		setTried(true);
		if (!x.valid || !x.input) return false;
		const r = await x.save();
		const v = r.value;
		const amount = v.booked ?? { minor: d.minor ?? 0, currency: d.currency };
		// Toast text is plain text, so the amount goes through the one formatter here.
		const words = {
			amount: formatMoney(amount, { locale }),
			account: x.account?.name ?? "",
		};
		const msg = v.kept
			? t("toast.kept", words)
			: v.plan.applied
				? t("toast.planned", { ...words, count: v.plan.lines.length })
				: x.account
					? t("toast.addedInto", words)
					: t("toast.added", words);
		toast.saved(msg, { undo: () => x.undo(v.expenseId, v.templateId) });
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={submit}
			open
			submitLabel={t("save")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<Field label={t("amount")}>
					<MoneyInput
						autoFocus
						currency={d.currency}
						onChange={x.setAmount}
						onCurrencyChange={x.setCurrency}
						showErrors={tried}
						value={d.amountText}
					/>
					{err("amount") && !d.amountText ? (
						<span className="text-danger text-meta" role="alert">
							{t("error.amount")}
						</span>
					) : null}
					{x.foreign && x.rates && x.rates.options.length > 1 ? (
						<FilterChips className="max-md:flex-wrap">
							{x.rates.options.map((o) => (
								<FilterChip
									key={o.rateType}
									onClick={() => x.set({ rateType: o.rateType })}
									selected={x.rateType === o.rateType}
								>
									{name(o.rateType)} <Money value={o.rate.value} />
								</FilterChip>
							))}
						</FilterChips>
					) : null}
					{err("rate") ? (
						<span className="text-danger text-meta" role="alert">
							{t("error.rate", { currency: d.currency })}
						</span>
					) : null}
					{/* The rate is stated once, on the chips; this is what it books. */}
					{picked?.home ? (
						<span className="text-fg-2 text-small">
							<Money figure="entry.income.home" value={picked.home} />
						</span>
					) : null}
				</Field>
				<Field
					error={err("source") ? t("error.source") : null}
					label={t("from")}
				>
					<SourceField
						onChange={(source) => x.set({ source })}
						value={d.source}
					/>
				</Field>
				<Field
					error={err("category") ? t("error.category") : null}
					label={t("whatItIs")}
				>
					<FilterChips className="max-md:flex-wrap">
						{cats.map((c) => (
							<FilterChip
								key={c.id}
								onClick={() => x.set({ categoryId: c.id })}
								selected={d.categoryId === c.id}
							>
								{c.name}
							</FilterChip>
						))}
					</FilterChips>
				</Field>
				<div className="grid gap-4 md:grid-cols-2">
					<Field label={t("into")}>
						<PlaceSelect
							label={t("into")}
							none={t("noAccountMenu")}
							onChange={(id) => x.set({ into: id, keep: null })}
							places={catalog.places.filter((p) => !p.liability)}
							value={d.into}
						/>
					</Field>
					<Field label={t("date")}>
						<DatePicker
							onChange={(date) => x.set({ date })}
							today={dayKey(new Date())}
							value={d.date}
						/>
					</Field>
				</div>
				{x.account ? (
					<Field label={t("whereItGoes")}>
						<Segmented
							label={t("whereItGoes")}
							onChange={(v) => x.set({ keep: v === "keep" })}
							options={[
								{ value: "budget", label: t("yourBudget") },
								{ value: "keep", label: t("keepInWealth") },
							]}
							value={x.kept ? "keep" : "budget"}
						/>
						<span className="text-fg-3 text-small">
							{x.account.inBudget
								? t("whereBudget", { account: x.account.name })
								: t("whereWealth", { account: x.account.name })}
						</span>
					</Field>
				) : (
					<p className="text-fg-3 text-small">{t("whereNone")}</p>
				)}
				<div className="flex items-center justify-between gap-3">
					<span className="text-body text-fg">
						{t("repeats")}
						<span className="block text-fg-3 text-meta">
							{t("repeatsHint")}
						</span>
					</span>
					<Switch
						aria-label={t("repeats")}
						checked={d.repeats}
						onCheckedChange={(v) => x.set({ repeats: v })}
					/>
				</div>
				<Field htmlFor="income-note" label={t("note")}>
					<Input
						id="income-note"
						onChange={(e) => x.set({ note: e.target.value })}
						placeholder={t("notePlaceholder")}
						value={d.note}
					/>
				</Field>
				{!x.kept ? (
					<Field label={t("afterSaving")}>
						<Segmented
							full
							label={t("afterSaving")}
							onChange={(v) => x.set({ usePlan: v === "plan" })}
							options={[
								{ value: "plan", label: t("usePlan") },
								{ value: "later", label: t("keepNotPlanned") },
							]}
							value={x.usePlan ? "plan" : "later"}
						/>
					</Field>
				) : null}
				<ChangesBlock
					byDesign={x.account ? [] : ["accounts"]}
					cannot={x.valid ? x.previewError : null}
					diff={x.preview}
					empty={tc("emptyAmount")}
					loading={x.previewLoading}
				/>
				{x.preview && !x.kept && x.usePlan ? (
					<PlanBlock plan={x.preview.value.plan} />
				) : null}
			</div>
		</Sheet>
	);
}
