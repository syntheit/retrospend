"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Sheet } from "~/components/ui/sheet";
import { ChangeValue } from "~/components/ui/sheet-changes";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { EnvelopeSelect, type Place, POOL } from "./envelope-select";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type PayInput = RouterInputs["envelope"]["recordDebtPayment"];

/** Not tracked: the money comes from outside any account (it is part of the budget). */
const NONE = "__none";

/**
 * Pay down a debt (SPEC §5.11, S14): the part that goes toward the balance
 * leaves the budget from the paying envelope (a card asks only for the
 * old-debt part: new card spending already came out of your envelopes), and
 * the interest in the payment is spending. The server previews the whole
 * write, the balance before and after included, and Undo deletes the
 * payment with everything it wrote.
 */
export function PayDebtSheet({
	open,
	onClose,
	month,
	envelopeId: startEnvelope,
}: SheetProps<{ envelopeId?: string }>) {
	const t = useTranslations("budgetSheets.payDebt");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const catalog = api.entry.catalog.useQuery();
	const currency = m.data?.book.currency ?? "";
	const debts = useMemo(
		() =>
			(catalog.data?.places ?? []).filter(
				(p) => p.liability && p.currency === currency,
			),
		[catalog.data, currency],
	);
	const [picked, setPicked] = useState<string | null>(null);
	const liability = picked ?? debts[0]?.id ?? null;
	const debt = debts.find((d) => d.id === liability) ?? null;
	const sources = useMemo(
		() =>
			(catalog.data?.places ?? []).filter(
				(p) => !p.liability && p.currency === currency,
			),
		[catalog.data, currency],
	);
	const [from, setFrom] = useState<string | null>(null);
	const [envelope, setEnvelope] = useState<string>(startEnvelope ?? POOL);
	const estimate = api.envelope.interestEstimate.useQuery(
		{ liabilityId: liability ?? "" },
		{ enabled: !!liability },
	);
	const principal = useAmount(
		currency,
		estimate.data?.suggested?.minor ?? null,
	);
	const interest = useAmount(currency, estimate.data?.interest?.minor ?? null);
	const [id] = useState(newId);

	const input: PayInput | null =
		liability && principal.minor && principal.minor > 0
			? {
					id,
					liabilityId: liability,
					fromAccountId: from,
					envelopeId: envelope === POOL ? null : envelope,
					principalMinor: principal.minor,
					interestMinor: interest.minor ?? 0,
				}
			: null;
	const preview = api.envelope.recordDebtPaymentPreview.useMutation();
	const commit = api.envelope.recordDebtPayment.useMutation();
	const remove = api.wealth.transfers.delete.save.useMutation();
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (r) =>
			t("toast", { name: debt?.name ?? "", amount: money(r.value.principal) }),
		undo: (r) => () => remove.mutateAsync({ transferId: r.value.transferId }),
	});

	const places = useMemo<Place[]>(
		() => [
			{ value: POOL, name: pool, amount: m.data?.toAssign.amount ?? null },
			...m.envelopes.map((e) => ({
				value: e.id,
				name: e.name,
				identity: e,
				amount: e.left,
			})),
		],
		[m.envelopes, m.data, pool],
	);
	const envelopeName = places.find((p) => p.value === envelope)?.name ?? pool;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("pay")}
			title={t("title")}
		>
			{m.loading || catalog.isLoading || !m.data ? (
				<SkeletonRows count={4} />
			) : debts.length === 0 ? (
				<p className="text-fg-2 text-small">{t("none")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<Field label={t("debt")}>
						<EnvelopeSelect
							label={t("debt")}
							onChange={setPicked}
							places={debts.map((d) => ({
								value: d.id,
								name: d.name,
								amount: d.balance,
							}))}
							value={liability}
						/>
					</Field>
					<Field label={t("from")}>
						<EnvelopeSelect
							label={t("from")}
							onChange={(v) => setFrom(v === NONE ? null : v)}
							places={[
								{ value: NONE, name: t("notTracked"), amount: null },
								...sources.map((s) => ({
									value: s.id,
									name: s.name,
									amount: s.balance,
								})),
							]}
							value={from ?? NONE}
						/>
					</Field>
					<Field label={t("envelope")}>
						<EnvelopeSelect
							label={t("envelope")}
							onChange={setEnvelope}
							places={places}
							value={envelope}
						/>
					</Field>
					<Field label={t("principal")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => principal.set(text)}
							value={principal.text}
						/>
					</Field>
					<Field label={t("interest")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => interest.set(text)}
							value={interest.text}
						/>
					</Field>
					{debt?.type === "LIABILITY_CREDIT_CARD" ? (
						<p className="text-fg-3 text-small">{t("card")}</p>
					) : null}
					<FigureChanges
						dry={w.dry}
						envelopeName={envelopeName}
						own={(p) => [
							{
								key: "balance",
								label: t("balance", { name: debt?.name ?? "" }),
								value: (
									<ChangeValue
										from={<Money value={p.value.balance.before} />}
										to={<Money value={p.value.balance.after} />}
									/>
								),
							},
						]}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
