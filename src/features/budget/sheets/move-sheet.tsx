"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Segmented } from "~/components/ui/segmented";
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

type Direction = "in" | "out";
type MoveInput = RouterInputs["envelope"]["move"];
type AssignInput = RouterInputs["envelope"]["assign"];

/**
 * The write a Move makes. The engine has no "move from To assign": that is
 * an assign, and taking money back to To assign is an unassign.
 */
type Op =
	| { kind: "assign"; input: AssignInput }
	| { kind: "move"; input: MoveInput };

/**
 * Move (SPEC §6.5): any place to any place, capped at what the source holds.
 * Add money takes it from To assign or another envelope; Take money out
 * sends it to either. The server previews exactly that write, and Save ends
 * with an Undo toast.
 */
export function MoveSheet({
	open,
	onClose,
	month,
	envelopeId,
	direction: startDirection = "in",
	amountMinor,
}: SheetComponentProps<"move">) {
	const t = useTranslations("budgetSheets.move");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { refresh, saved, undoOf, money } = useBudgetWrite();
	const env = m.byId.get(envelopeId) ?? null;
	const currency = m.data?.book.currency ?? "";
	const [direction, setDirection] = useState<Direction>(startDirection);
	const [peer, setPeer] = useState<string>(POOL);
	const gap = env?.target?.need.minor ?? 0;
	const amount = useAmount(currency, amountMinor ?? (gap > 0 ? gap : null));
	const [id] = useState(newId);
	const [itemId] = useState(newId);

	const places = useMemo<Place[]>(() => {
		const list: Place[] = [
			{
				value: POOL,
				name: pool,
				amount: m.data?.toAssign.amount ?? null,
				disabled:
					direction === "in" && (m.data?.toAssign.amount.minor ?? 0) <= 0,
			},
		];
		for (const e of m.envelopes)
			if (e.id !== envelopeId)
				list.push({
					value: e.id,
					name: e.name,
					amount: e.left,
					disabled: direction === "in" && e.left.minor <= 0,
				});
		return list;
	}, [m.envelopes, m.data, envelopeId, pool, direction]);

	const op: Op | null = useMemo(() => {
		const minor = amount.minor;
		if (!m.monthKey || !minor || minor <= 0) return null;
		const month = m.monthKey;
		if (direction === "in" && peer === POOL)
			return {
				kind: "assign",
				input: {
					batchId: id,
					month,
					mode: "add",
					items: [{ id: itemId, envelopeId, amountMinor: minor }],
				},
			};
		const from = direction === "in" ? peer : envelopeId;
		const to = direction === "in" ? envelopeId : peer;
		return {
			kind: "move",
			input: {
				id,
				month,
				from: from === POOL ? null : from,
				to: to === POOL ? null : to,
				amountMinor: minor,
				kind: from === POOL || to === POOL ? "UNASSIGN" : "MOVE",
			},
		};
	}, [amount.minor, m.monthKey, direction, peer, envelopeId, id, itemId]);

	const previewAssign = api.envelope.assignPreview.useMutation();
	const previewMove = api.envelope.movePreview.useMutation();
	const commitAssign = api.envelope.assign.useMutation();
	const commitMove = api.envelope.move.useMutation();
	const dry = useDryRun(
		(o: Op) =>
			o.kind === "assign"
				? previewAssign.mutateAsync(o.input)
				: previewMove.mutateAsync(o.input),
		op,
	);

	const onSubmit = async () => {
		if (!op || !env) return false;
		if (op.kind === "assign") await commitAssign.mutateAsync(op.input);
		else await commitMove.mutateAsync(op.input);
		await refresh();
		const other = places.find((p) => p.value === peer)?.name ?? pool;
		const minor = amount.minor ?? 0;
		saved(
			t(direction === "in" ? "toastIn" : "toastOut", {
				amount: money({ minor, currency }),
				name: env.name,
				other,
			}),
			undoOf(op.kind === "assign" ? { batchId: id } : { movementId: id }),
		);
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={dry.status !== "ready"}
			submitLabel={t("move")}
			title={env?.name ?? t("title")}
		>
			{m.loading || !env ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t.rich("has", {
							left: () => <Money figure="envelope.left" value={env.left} />,
						})}
					</p>
					<Segmented
						label={t("direction")}
						onChange={(d) => {
							setDirection(d);
							setPeer(POOL);
						}}
						options={[
							{ value: "in", label: t("in") },
							{ value: "out", label: t("out") },
						]}
						value={direction}
					/>
					<Field label={direction === "in" ? t("from") : t("to")}>
						<EnvelopeSelect
							label={direction === "in" ? t("from") : t("to")}
							onChange={setPeer}
							places={places}
							value={peer}
						/>
					</Field>
					<Field label={t("amount")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					{gap > 0 && direction === "in" ? (
						<p className="text-fg-3 text-small">
							{t.rich("gap", {
								amount: () => <Money value={env.target?.need ?? null} />,
							})}
						</p>
					) : null}
					<MovementChanges
						byId={m.byId}
						dry={dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
