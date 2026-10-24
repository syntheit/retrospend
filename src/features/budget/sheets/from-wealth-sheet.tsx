"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
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
import { type TransferInput, useTransferWrite } from "./use-transfer-write";
import { newId, useBudgetWrite } from "./use-write";

type Mode = "moved" | "count";
type MoveIn = RouterInputs["wealth"]["income"]["moveIn"]["save"];

/** Not tracked: money that is not in any account. */
const NONE = "__none";

/**
 * Move from Wealth (MONEY-MOVES §2.2, D4): money in Wealth that the budget
 * should use. Either you moved it (a transfer from a Wealth account into one
 * the budget counts, or Not tracked) or you only count it (the account keeps
 * it and the budget counts that much). Both go to an envelope or to Not
 * planned yet, are previewed by the server, and Undo takes them back.
 */
export function FromWealthSheet({
	open,
	onClose,
	month,
	envelopeId: startEnvelope,
}: SheetProps<{ envelopeId?: string }>) {
	const t = useTranslations("budgetSheets.fromWealth");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const catalog = api.entry.catalog.useQuery();
	const home = m.data?.book.currency ?? "";
	const places = catalog.data?.places ?? [];
	const wealth = useMemo(
		() => places.filter((p) => !p.inBudget && !p.liability),
		[places],
	);
	const budget = useMemo(
		() => places.filter((p) => p.inBudget && !p.liability),
		[places],
	);
	const [mode, setMode] = useState<Mode>("moved");
	const [source, setSource] = useState<string | null>(null);
	const [into, setInto] = useState<string | null>(null);
	const [envelope, setEnvelope] = useState<string>(startEnvelope ?? POOL);
	const from = wealth.find((p) => p.id === (source ?? wealth[0]?.id)) ?? null;
	const toPlace = budget.find((p) => p.id === into) ?? null;
	const fromCur = from?.currency ?? home;
	const toCur = toPlace?.currency ?? home;
	const exchange = fromCur !== toCur;
	const out = useAmount(fromCur);
	const got = useAmount(toCur);
	const [moveId] = useState(newId);
	const putIn = envelope === POOL ? null : envelope;

	const moved: TransferInput | null =
		mode === "moved" && from && out.minor && out.minor > 0
			? {
					fromAccountId: from.id,
					toAccountId: into,
					fromCurrency: fromCur,
					toCurrency: toCur,
					fromAmount: fromMinor({ minor: out.minor, currency: fromCur }),
					...(exchange && got.minor
						? { toAmount: fromMinor({ minor: got.minor, currency: toCur }) }
						: {}),
					putIn,
				}
			: null;
	const transfer = useTransferWrite({
		input: moved,
		toast: (r) => t("toastMoved", { amount: money(r.value.to) }),
	});

	const counted: MoveIn | null =
		mode === "count" && from && out.minor && out.minor > 0
			? {
					id: moveId,
					accountId: from.id,
					units: fromMinor({ minor: out.minor, currency: fromCur }),
					putIn,
				}
			: null;
	const utils = api.useUtils();
	const countSave = api.wealth.income.moveIn.save.useMutation();
	const countUndo = api.wealth.income.undoMoveIn.save.useMutation();
	const count = useMoneyWrite({
		input: counted,
		preview: (i) =>
			utils.wealth.income.moveIn.preview.fetch(i, { staleTime: 0 }),
		commit: (i) => countSave.mutateAsync(i),
		toast: () => t("toastCounted", { name: from?.name ?? "" }),
		undo: (_r, i) => () => countUndo.mutateAsync(i),
	});
	const w = mode === "moved" ? transfer : count;

	const envelopes = useMemo<Place[]>(
		() => [
			{ value: POOL, name: pool, amount: m.data?.toAssign.amount ?? null },
			...m.envelopes.map((e) => ({
				value: e.id,
				name: e.name,
				amount: e.left,
			})),
		],
		[m.envelopes, m.data, pool],
	);
	const envelopeName = envelopes.find((p) => p.value === envelope)?.name;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("move")}
			title={t("title")}
		>
			{m.loading || catalog.isLoading || !m.data ? (
				<SkeletonRows count={3} />
			) : wealth.length === 0 ? (
				<p className="text-fg-2 text-small">{t("none")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<Segmented
						label={t("mode")}
						onChange={setMode}
						options={[
							{ value: "moved", label: t("moved") },
							{ value: "count", label: t("count") },
						]}
						value={mode}
					/>
					<p className="text-fg-3 text-small">{t(`about.${mode}`)}</p>
					<Field label={t("from")}>
						<EnvelopeSelect
							label={t("from")}
							onChange={setSource}
							places={wealth.map((s) => ({
								value: s.id,
								name: s.name,
								amount: s.balance,
							}))}
							value={from?.id ?? null}
						/>
					</Field>
					{mode === "moved" ? (
						<Field label={t("into")}>
							<EnvelopeSelect
								label={t("into")}
								onChange={(v) => setInto(v === NONE ? null : v)}
								places={[
									{ value: NONE, name: t("notTracked"), amount: null },
									...budget.map((s) => ({
										value: s.id,
										name: s.name,
										amount: s.balance,
									})),
								]}
								value={into ?? NONE}
							/>
						</Field>
					) : null}
					<Field label={mode === "moved" ? t("amount") : t("units")}>
						<MoneyInput
							currency={fromCur}
							onChange={(text) => out.set(text)}
							value={out.text}
						/>
					</Field>
					{mode === "moved" && exchange ? (
						<Field label={t("got")}>
							<MoneyInput
								currency={toCur}
								onChange={(text) => got.set(text)}
								value={got.text}
							/>
						</Field>
					) : null}
					<Field label={t("putIn")}>
						<EnvelopeSelect
							label={t("putIn")}
							onChange={setEnvelope}
							places={envelopes}
							value={envelope}
						/>
					</Field>
					<FigureChanges
						dry={w.dry}
						envelopeName={envelopeName}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
