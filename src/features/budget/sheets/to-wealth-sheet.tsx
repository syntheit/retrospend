"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api } from "~/trpc/react";
import { EnvelopeSelect } from "./envelope-select";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMonth } from "./use-month";
import { type TransferInput, useTransferWrite } from "./use-transfer-write";
import { useBudgetWrite } from "./use-write";

/** Not tracked: money that is not in any account. */
const NONE = "__none";

/**
 * Move to Wealth (D24, MONEY-MOVES §2.5): money leaves an envelope for an
 * account outside the budget (buying dollars to save, a savings account).
 * It is the Transfer's own write with the envelope it comes from named, so
 * the server previews the accounts, the envelope and Not planned yet before
 * Save, and Undo deletes the move with its budget side. A goal's progress
 * does not change.
 */
export function ToWealthSheet({
	open,
	onClose,
	month,
	envelopeId,
}: SheetProps<{ envelopeId: string }>) {
	const t = useTranslations("budgetSheets.toWealth");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const catalog = api.entry.catalog.useQuery();
	const env = m.byId.get(envelopeId) ?? null;
	const home = m.data?.book.currency ?? "";
	const places = catalog.data?.places ?? [];
	const sources = useMemo(
		() => places.filter((p) => p.inBudget && !p.liability),
		[places],
	);
	const targets = useMemo(
		() => places.filter((p) => !p.inBudget && !p.liability),
		[places],
	);
	const [from, setFrom] = useState<string | null>(null);
	const [into, setInto] = useState<string | null>(null);
	const toPlace = targets.find((p) => p.id === (into ?? targets[0]?.id));
	const fromPlace = sources.find((p) => p.id === from) ?? null;
	const fromCur = fromPlace?.currency ?? home;
	const toCur = toPlace?.currency ?? home;
	const exchange = fromCur !== toCur;
	const out = useAmount(fromCur);
	const got = useAmount(toCur);

	const input: TransferInput | null =
		toPlace && out.minor && out.minor > 0
			? {
					fromAccountId: from,
					toAccountId: toPlace.id,
					fromCurrency: fromCur,
					toCurrency: toCur,
					fromAmount: fromMinor({ minor: out.minor, currency: fromCur }),
					...(exchange && got.minor
						? { toAmount: fromMinor({ minor: got.minor, currency: toCur }) }
						: {}),
					envelopeId,
				}
			: null;
	const w = useTransferWrite({
		input,
		toast: (r) =>
			t("toast", {
				amount: money(r.value.from),
				name: env?.name ?? "",
				account: toPlace?.name ?? "",
			}),
	});

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("move")}
			title={t("title", { name: env?.name ?? "" })}
		>
			{m.loading || catalog.isLoading || !m.data ? (
				<SkeletonRows count={3} />
			) : targets.length === 0 ? (
				<p className="text-fg-2 text-small">{t("noAccount")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t("lead", { name: env?.name ?? "" })}
					</p>
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
					<Field label={t("into")}>
						<EnvelopeSelect
							label={t("into")}
							onChange={setInto}
							places={targets.map((s) => ({
								value: s.id,
								name: s.name,
								amount: s.balance,
							}))}
							value={toPlace?.id ?? null}
						/>
					</Field>
					<Field label={t("amount")}>
						<MoneyInput
							currency={fromCur}
							onChange={(text) => out.set(text)}
							value={out.text}
						/>
					</Field>
					{exchange ? (
						<Field label={t("got")}>
							<MoneyInput
								currency={toCur}
								onChange={(text) => got.set(text)}
								value={got.text}
							/>
						</Field>
					) : null}
					<FigureChanges dry={w.dry} envelopeName={env?.name} poolName={pool} />
				</div>
			)}
		</Sheet>
	);
}
