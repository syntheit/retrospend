"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterOutputs } from "~/trpc/react";
import { useBudgetSheet } from "../use-budget-sheet";
import { EnvelopeSelect, type Place } from "./envelope-select";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMonth } from "./use-month";

type Answer = NonNullable<RouterOutputs["envelope"]["afford"]>;

/** The sentence for the state: the server says which, and every number in it. */
function Sentence({ a, pool }: { a: Answer; pool: string }) {
	const t = useTranslations("budgetSheets.afford");
	const money = (v: { minor: number; currency: string }, sign?: "never") => (
		<Money sign={sign} value={v} />
	);
	return (
		<p className="text-fg text-body">
			{t.rich(`state.${a.state}`, {
				after: () => money(a.after, "never"),
				short: () => money(a.short),
				left: () => money(a.left),
				spent: () => money(a.spent),
				notPlanned: () => money(a.notPlanned),
				pool,
			})}
		</p>
	);
}

/**
 * Can I afford it? One amount, one answer (SYNTHESIS-r6 §4). The server
 * reads the same Left to spend (or Left this week, or one envelope's Left)
 * the page shows and returns the state with every figure; this writes the
 * words. It writes nothing; when something would make it fit, the button
 * opens that sheet.
 */
function AffordForm({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.afford");
	const tp = useTranslations("budgetSheets.pool");
	const m = useMonth(month);
	const sheets = useBudgetSheet();
	const router = useRouter();
	const currency = m.data?.book.currency ?? "";
	const style = m.data?.book.style;
	const byEnvelope = style === "EVERY_DOLLAR" || style === "LIMITS";
	const amount = useAmount(currency);
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	// Wait for typing to settle: one read per amount, not per key.
	const [asked, setAsked] = useState<number | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setAsked(amount.minor), 300);
		return () => clearTimeout(timer);
	}, [amount.minor]);
	const places = useMemo<Place[]>(
		() =>
			m.envelopes
				.filter((e) => e.kind !== "SAVINGS")
				.map((e) => ({
					value: e.id,
					name: e.name,
					identity: e,
					amount: e.left,
				})),
		[m.envelopes],
	);
	const answer = api.envelope.afford.useQuery(
		{
			month: m.monthKey ?? undefined,
			amountMinor: asked ?? 1,
			...(byEnvelope && envelopeId ? { envelopeId } : {}),
		},
		{ enabled: asked !== null && asked > 0 && m.monthKey !== null },
	);
	const a = asked && asked > 0 ? (answer.data ?? null) : null;
	const pool = style === "EVERY_DOLLAR" ? tp("toAssign") : tp("notPlannedYet");
	const act = a?.action ?? null;
	const run = () => {
		if (!act || !m.data) return;
		if (act.kind === "PLAN_NEXT_MONTH") {
			onClose();
			router.push(`/budget?month=${act.month}`);
			return;
		}
		const target =
			act.kind === "MOVE_MONEY"
				? act.envelopeId
				: m.data.book.defaultEnvelopeId;
		sheets.open("move", {
			month: m.data.month.key,
			envelopeId: target,
			direction: "in",
			amountMinor: act.amount.minor,
		});
	};
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<Field label={t("amount")}>
					<MoneyInput
						autoFocus
						currency={currency}
						onChange={(text) => amount.set(text)}
						value={amount.text}
					/>
				</Field>
				{byEnvelope ? (
					<Field label={t("envelope")}>
						<EnvelopeSelect
							label={t("envelope")}
							onChange={setEnvelopeId}
							placeholder={t("everythingElse")}
							places={places}
							value={envelopeId}
						/>
					</Field>
				) : null}
				{answer.isError ? (
					<Notice tone="danger">{t("failed")}</Notice>
				) : a ? (
					<div aria-live="polite" className="flex flex-col gap-2">
						<Sentence a={a} pool={pool} />
						{a.state === "FITS" ||
						a.state === "FITS_TIGHT" ||
						a.state === "WEEK_FITS" ? (
							<p className="text-fg-2 text-small">
								{t.rich("perDay", {
									perDay: () => <Money cents={false} value={a.perDay} />,
									days: a.daysLeft,
								})}
							</p>
						) : null}
						{a.usualPerDay ? (
							<p className="text-fg-3 text-small">
								{t.rich("usual", {
									usual: () => <Money value={a.usualPerDay} />,
								})}
							</p>
						) : null}
						{a.incomplete ? (
							<p className="text-fg-3 text-small">{t("incomplete")}</p>
						) : null}
						{act ? (
							<div>
								<Button kind="secondary" onClick={run} size="sm">
									{t.rich(`action.${act.kind}`, {
										amount: () =>
											act.kind === "PLAN_NEXT_MONTH" ? null : (
												<Money value={act.amount} />
											),
									})}
								</Button>
							</div>
						) : null}
					</div>
				) : asked && asked > 0 ? (
					<SkeletonRows count={2} />
				) : (
					<p className="text-fg-3 text-small">{t("idle")}</p>
				)}
			</div>
		</Sheet>
	);
}

/** Can I afford it?: opens once the month is read, so the style and envelopes are known. */
export function AffordSheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.afford");
	const m = useMonth(props.month);
	if (m.loading || !m.data)
		return (
			<Sheet
				detent="large"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("title")}
			>
				<SkeletonRows count={3} />
			</Sheet>
		);
	return <AffordForm {...props} />;
}
