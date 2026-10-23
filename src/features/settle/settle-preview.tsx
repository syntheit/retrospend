"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Segmented } from "~/components/ui/segmented";
import { useRateTypeName } from "~/features/people/rate-type";
import type { PersonIdentityDTO } from "~/features/people/types";
import { Changes } from "./settle-changes";
import type { SettleState } from "./use-settle";

type Preview = NonNullable<SettleState["preview"]>;
type Allocation = NonNullable<Preview["value"]["allocation"]>;

/**
 * Rate types the conversion can use, and the rate each converting currency
 * uses now: cash that converts and offsets across currencies alike. A new
 * type moves Everything too, so the chips show whenever anything converts.
 */
function Rates({ s, allocation }: { s: SettleState; allocation: Allocation }) {
	const t = useTranslations("settleSheet");
	const name = useRateTypeName();
	const c = s.ctx;
	const pay = allocation.amount.currency;
	const currencies = [
		...new Set([
			...allocation.rows
				.filter((r) => !r.excess && r.pays.currency !== pay)
				.map((r) => r.pays.currency),
			...allocation.offsets
				.filter((o) => o.cancels.currency !== pay)
				.map((o) => o.cancels.currency),
		]),
	];
	if (!c || currencies.length === 0) return null;
	const rates = currencies.flatMap((cur) => {
		const rate = c.rates.find((r) => r.currency === cur)?.rate;
		return rate ? [{ cur, rate }] : [];
	});
	const current = s.rateType ?? rates[0]?.rate.type ?? null;
	return (
		<div className="flex flex-col gap-2">
			<span className="text-fg text-small font-medium">
				{t("rate", { currency: currencies.join(", ") })}
			</span>
			{c.rateTypes.length > 1 && (
				<FilterChips>
					{c.rateTypes.map((type) => (
						<FilterChip
							key={type}
							onClick={() => s.setRateType(type)}
							selected={current === type}
						>
							{name(type)}
						</FilterChip>
					))}
				</FilterChips>
			)}
			{rates.map(({ cur, rate }) => (
				<span className="text-fg-2 text-small" key={cur}>
					<Money value={rate.unit} /> = <Money value={rate.value} /> ·{" "}
					{name(rate.type)}
				</span>
			))}
		</div>
	);
}

/** "This pays": every scope the payment reaches, what stays, offsets. */
function Pays({
	s,
	allocation,
	person,
}: {
	s: SettleState;
	allocation: Allocation;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet");
	const names = new Map(
		(s.ctx?.lines ?? []).map((l) => [
			l.project?.id ?? null,
			l.project?.name ?? "",
		]),
	);
	const scopeName = (scope: string | null) =>
		scope ? names.get(scope) || t("project") : t("outside");
	const left = (scope: string | null, currency: string) =>
		allocation.remainder.find(
			(r) => r.scope === scope && r.owed.currency === currency,
		)?.owed;
	const incoming = s.ctx?.direction === "incoming";
	return (
		<section aria-label={t("pays")} className="flex flex-col">
			<h3 className="text-fg text-small border-line mb-1 border-b pb-1 font-semibold">
				{t("pays")}
			</h3>
			{allocation.rows.map((r) => (
				<div
					className="border-line flex items-baseline justify-between gap-3 border-b py-2"
					key={`${r.scope}-${r.pays.currency}-${r.excess}`}
				>
					<span className="min-w-0">
						<span className="text-fg text-body block truncate">
							{r.excess
								? t("moreThanOwed", { name: person.name })
								: scopeName(r.scope)}
						</span>
						<span className="text-fg-3 text-meta">
							{r.excess
								? incoming
									? t("youWillOwe", { name: person.name })
									: t("theyWillOwe", { name: person.name })
								: t("balanceIn", { currency: r.pays.currency })}
						</span>
					</span>
					<span className="text-body flex flex-col items-end tabular-nums">
						<span>
							<Money value={r.pays} />
							{r.pays.currency !== r.paid.currency && (
								<span className="text-fg-3">
									{" = "}
									<Money value={r.paid} />
								</span>
							)}
						</span>
						{!r.excess && <Left amount={left(r.scope, r.pays.currency)} />}
					</span>
				</div>
			))}
			{allocation.offsets.map((o) => (
				<div
					className="border-line flex items-baseline justify-between gap-3 border-b py-2"
					key={`off-${o.scope}-${o.cancels.currency}`}
				>
					<span className="min-w-0">
						<span className="text-fg text-body block truncate">
							{scopeName(o.scope)}
						</span>
						<span className="text-fg-3 text-meta">{t("offset")}</span>
					</span>
					<span className="text-fg-2 text-body tabular-nums">
						<Money value={o.cancels} />
						{o.cancels.currency !== o.value.currency && (
							<span className="text-fg-3">
								{" = "}
								<Money value={o.value} />
							</span>
						)}
					</span>
				</div>
			))}
		</section>
	);
}

function Left({ amount }: { amount?: { minor: number; currency: string } }) {
	const t = useTranslations("settleSheet");
	if (!amount || amount.minor === 0)
		return (
			<span className="text-fg-3 text-meta inline-flex items-center gap-1">
				<Check aria-hidden="true" className="text-positive size-3" />
				{t("settled")}
			</span>
		);
	return (
		<span className="text-fg-3 text-meta">
			{t.rich("left", { amount: () => <Money value={amount} /> })}
		</span>
	);
}

/** Overpaying asks first (owner Q2): record it anyway, or record what is owed. */
export function Overpay({
	s,
	allocation,
	person,
}: {
	s: SettleState;
	allocation: Allocation;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet");
	if (!allocation.overpay || s.allowOverpay) return null;
	const incoming = s.ctx?.direction === "incoming";
	return (
		<section className="flex flex-col gap-2" role="alert">
			<h3 className="text-attention-text text-small font-semibold">
				{t.rich(incoming ? "overTheyOwe" : "overYouOwe", {
					amount: () => <Money value={allocation.overpay} />,
					name: person.name,
				})}
			</h3>
			<div className="flex flex-wrap gap-2">
				<Button kind="secondary" onClick={s.overpayOk} size="sm">
					{t("recordAnyway")}
				</Button>
				{allocation.full.minor > 0 && (
					<Button
						kind="secondary"
						onClick={() => s.fill(allocation.full, false)}
						size="sm"
					>
						{t.rich("recordExact", {
							amount: () => <Money value={allocation.full} />,
						})}
					</Button>
				)}
			</div>
		</section>
	);
}

/** "Same payment?" (MONEY-MOVES §1.5): money received that matches their claim. */
export function SamePayment({
	s,
	person,
}: {
	s: SettleState;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet");
	const { short } = useRowDates();
	const claim = s.claim;
	if (!claim || s.ctx?.direction !== "incoming") return null;
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-fg text-small font-semibold">{t("samePayment")}</h3>
			<p className="text-fg-2 text-small">
				{t.rich("theirRecord", {
					name: person.name,
					amount: () => (
						<Money value={{ minor: claim.amount, currency: claim.currency }} />
					),
					date: short(claim.paidOn),
				})}
			</p>
			<Segmented
				label={t("samePayment")}
				onChange={(v) => s.setDifferent(v === "different")}
				options={[
					{ value: "same", label: t("same") },
					{ value: "different", label: t("different") },
				]}
				value={s.claimId ? "same" : "different"}
			/>
			<span className="text-fg-3 text-meta">
				{s.claimId
					? t("sameHint", { name: person.name })
					: t("differentHint", { name: person.name })}
			</span>
		</section>
	);
}

export function SettlePreview({
	s,
	person,
}: {
	s: SettleState;
	person: PersonIdentityDTO;
}) {
	const preview = s.preview;
	if (!preview) return null;
	const allocation = preview.value.allocation;
	return (
		<div aria-busy={s.previewing} className="flex flex-col gap-4">
			{allocation && <Rates allocation={allocation} s={s} />}
			<SamePayment person={person} s={s} />
			{allocation && <Overpay allocation={allocation} person={person} s={s} />}
			{allocation && <Pays allocation={allocation} person={person} s={s} />}
			{preview.value.recorded && <Changes person={person} preview={preview} />}
		</div>
	);
}
