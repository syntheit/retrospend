"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useRowDates } from "~/components/rows/dates";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { EnvelopeSelect, type Place, POOL } from "./envelope-select";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useAmount } from "./use-amount";
import { useDryRun } from "./use-dry-run";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type CoverInput = RouterInputs["envelope"]["cover"];

/**
 * Cover (SPEC §6.5): an overspent envelope takes money from To assign or
 * another envelope. The server orders the sources (To assign, Monthly by
 * Left, Savings, Bills last with their due date); the first one that holds
 * enough is preselected, never a goal or a bill by default. The amount is
 * the overspend. Save ends with an Undo toast for the one movement.
 */
export function CoverSheet({
	open,
	onClose,
	month,
	envelopeId,
}: SheetComponentProps<"cover">) {
	const t = useTranslations("budgetSheets.cover");
	const { short } = useRowDates();
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { refresh, saved, undoOf, money } = useBudgetWrite();
	const env = m.byId.get(envelopeId) ?? null;
	const over = env && env.left.minor < 0 ? -env.left.minor : 0;
	const currency = m.data?.book.currency ?? "";
	const sources = api.envelope.coverSources.useQuery(
		{ envelopeId, ...(m.monthKey ? { month: m.monthKey } : {}) },
		{ enabled: m.data !== null },
	);
	const amount = useAmount(currency, over);
	const [picked, setPicked] = useState<string | null>(null);
	const [id] = useState(newId);

	const places = useMemo<Place[]>(
		() =>
			(sources.data ?? []).map((s) => ({
				value: s.from ?? POOL,
				name: s.from ? (m.byId.get(s.from)?.name ?? "") : pool,
				amount: s.available,
				note:
					s.kind === "BILL" && s.dueDate
						? t("billDue", { date: short(s.dueDate) })
						: undefined,
			})),
		[sources.data, m.byId, pool, short, t],
	);
	// Not a goal and not a bill by default; the first with enough, else the first.
	const flexible = (sources.data ?? []).filter(
		(s) => s.kind === "POOL" || s.kind === "MONTHLY",
	);
	const best =
		flexible.find((s) => s.available.minor >= over) ?? flexible[0] ?? null;
	const value = picked ?? (best ? (best.from ?? POOL) : null);
	const from = value === null || value === POOL ? null : value;

	const input: CoverInput | null =
		m.monthKey && value !== null && amount.minor && amount.minor > 0
			? {
					id,
					month: m.monthKey,
					envelopeId,
					from,
					amountMinor: amount.minor,
				}
			: null;
	const previewMutation = api.envelope.coverPreview.useMutation();
	const commit = api.envelope.cover.useMutation();
	const dry = useDryRun(previewMutation.mutateAsync, input);

	const onSubmit = async () => {
		if (!input || !env) return false;
		await commit.mutateAsync(input);
		await refresh();
		const source = places.find((p) => p.value === value)?.name ?? pool;
		saved(
			t("toast", {
				name: env.name,
				amount: money({ minor: input.amountMinor, currency }),
				source,
			}),
			undoOf({ movementId: input.id }),
		);
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={dry.status !== "ready"}
			submitLabel={t("cover")}
			title={t("title", { name: env?.name ?? "" })}
		>
			{m.loading || !env ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t.rich("lead", {
							name: env.name,
							amount: () => <Money sign="never" value={env.left} />,
						})}
					</p>
					<Field label={t("from")}>
						<EnvelopeSelect
							label={t("from")}
							onChange={setPicked}
							placeholder={t("pick")}
							places={places}
							value={value}
						/>
					</Field>
					<Field label={t("amount")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					{sources.data && flexible.length === 0 ? (
						<p className="text-fg-3 text-small">{t("noFlexible")}</p>
					) : null}
					<MovementChanges
						byId={m.byId}
						dry={dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
					<p className="text-fg-3 text-small">{t("leave")}</p>
				</div>
			)}
		</Sheet>
	);
}
