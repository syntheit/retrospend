"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api } from "~/trpc/react";
import { EnvelopeSelect, type Place, POOL } from "./envelope-select";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useAmount } from "./use-amount";
import { useDryRun } from "./use-dry-run";
import { useMonth } from "./use-month";
import { newId } from "./use-write";

/**
 * What if I spend (SPEC §5.13, D10): a pretend expense on a draft. Nothing is
 * saved to your money: the draft only lives while the sheet is open and is
 * discarded when it closes. The server's draft preview says what the
 * envelope would have, and when it would go short, where a cover could come
 * from.
 */
export function WhatIfSheet({
	open,
	onClose,
	month,
	envelopeId: startId,
}: SheetComponentProps<"whatIf">) {
	const t = useTranslations("budgetSheets.whatIf");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const [picked, setPicked] = useState<string | null>(startId ?? null);
	const envelopeId = picked;
	const env = envelopeId ? (m.byId.get(envelopeId) ?? null) : null;
	const amount = useAmount(m.data?.book.currency ?? "");
	const [draftId] = useState(newId);
	const [rowId] = useState(newId);
	const save = api.envelope.saveDraft.useMutation();
	const preview = api.useUtils().envelope.previewDraft;
	const discard = api.envelope.discardDraft.useMutation();
	const saved = useRef(false);

	const input = useMemo(
		() =>
			m.monthKey && envelopeId && amount.minor && amount.minor > 0
				? { month: m.monthKey, envelopeId, amountMinor: amount.minor }
				: null,
		[m.monthKey, envelopeId, amount.minor],
	);
	const dry = useDryRun(async (i: NonNullable<typeof input>) => {
		await save.mutateAsync({
			id: draftId,
			kind: "WHAT_IF",
			month: i.month,
			lines: [],
			moves: [],
			expectedIn: [],
			pretend: [
				{
					id: rowId,
					kind: "OUT",
					categoryId: null,
					envelopeId: i.envelopeId,
					amountMinor: i.amountMinor,
				},
			],
		});
		saved.current = true;
		return preview.fetch({ draftId }, { staleTime: 0 });
	}, input);

	const places = useMemo<Place[]>(
		() =>
			m.envelopes.map((e) => ({ value: e.id, name: e.name, amount: e.left })),
		[m.envelopes],
	);
	const mine = dry.preview?.envelopes.find((e) => e.envelopeId === envelopeId);
	const short = dry.preview?.shortfalls.find(
		(s) => s.envelopeId === envelopeId,
	);
	const close = () => {
		if (saved.current) void discard.mutateAsync({ draftId });
		onClose();
	};
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="large"
			onOpenChange={(o) => !o && close()}
			open={open}
			title={env ? t("title", { name: env.name }) : t("titleAny")}
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">{t("lead")}</p>
					{startId ? null : (
						<Field label={t("envelope")}>
							<EnvelopeSelect
								label={t("envelope")}
								onChange={(v) => setPicked(v === POOL ? null : v)}
								placeholder={t("pick")}
								places={places}
								value={picked}
							/>
						</Field>
					)}
					<Field label={t("ifSpend")}>
						<MoneyInput
							currency={m.data.book.currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					{dry.status === "error" ? (
						<p className="text-fg-3 text-small">{t("cannot")}</p>
					) : mine && env ? (
						<RowList variant="flat">
							<Row
								end={<Money value={mine.left.after} />}
								title={t("wouldHave", { name: env.name })}
							/>
							{short
								? short.cover.map((c) => (
										<Row
											end={<Money value={c.amount} />}
											key={c.from ?? POOL}
											sub={
												<RowSub
													parts={[
														t("coverFrom", {
															name: c.from
																? (m.byId.get(c.from)?.name ?? "")
																: pool,
														}),
													]}
												/>
											}
											title={t("coverIt")}
										/>
									))
								: null}
							{short && short.uncovered.minor > 0 ? (
								<Row
									end={<Money value={short.uncovered} />}
									title={t("uncovered")}
								/>
							) : null}
						</RowList>
					) : (
						<p className="text-fg-3 text-small">{t("idle")}</p>
					)}
				</div>
			)}
		</Sheet>
	);
}
