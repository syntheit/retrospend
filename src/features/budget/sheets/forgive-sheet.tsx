"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Face } from "~/components/ui/avatar-face";
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
import { newId, useBudgetWrite } from "./use-write";

type ForgiveInput = RouterInputs["envelope"]["forgive"];

/**
 * Forgive (SPEC §6.9): part or all of what one person owes you in one
 * currency. It comes off their balance and the cost is charged to an
 * envelope; no money comes back, so To assign does not change. The server
 * previews the write and Undo restores the balance.
 */
export function ForgiveSheet({
	open,
	onClose,
	month,
	participant,
}: SheetProps<{
	participant: { type: "user" | "guest" | "shadow"; id: string };
}>) {
	const t = useTranslations("budgetSheets.forgive");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const owed = api.envelope.owed.useQuery();
	const person =
		owed.data?.people.find(
			(p) =>
				p.participant.type === participant.type &&
				p.participant.id === participant.id,
		) ?? null;
	// A balance you are owed: positive lines only (a negative line is yours to pay).
	const lines = (person?.lines ?? []).filter((l) => l.amount.minor > 0);
	const [currency, setCurrency] = useState<string | null>(null);
	const line =
		lines.find((l) => l.amount.currency === currency) ?? lines[0] ?? null;
	const amount = useAmount(
		line?.amount.currency ?? "",
		line?.amount.minor ?? null,
	);
	const [envelopeId, setEnvelopeId] = useState<string>(POOL);
	const [id] = useState(newId);
	const first = (person?.name ?? "").split(" ")[0] ?? "";

	const places = useMemo<Place[]>(
		() => [
			{
				value: POOL,
				name:
					m.byId.get(m.data?.book.defaultEnvelopeId ?? "")?.name ??
					t("everythingElse"),
				amount: null,
			},
			...m.envelopes
				.filter((e) => e.id !== m.data?.book.defaultEnvelopeId)
				.map((e) => ({ value: e.id, name: e.name, amount: e.left })),
		],
		[m.envelopes, m.byId, m.data, t],
	);
	const input: ForgiveInput | null =
		person && line && amount.minor !== null && amount.minor > 0
			? {
					id,
					participant: person.participant,
					currency: line.amount.currency,
					amountMinor: amount.minor,
					envelopeId: envelopeId === POOL ? null : envelopeId,
				}
			: null;
	const preview = api.envelope.forgivePreview.useMutation();
	const commit = api.envelope.forgive.useMutation();
	const undo = api.envelope.unforgive.useMutation();
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (r) => t("toast", { name: first, amount: money(r.value.amount) }),
		undo: (r) => () => undo.mutateAsync({ paymentId: r.value.paymentId }),
	});

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("forgive")}
			title={t("title", { name: first })}
		>
			{!owed.data || m.loading ? (
				<SkeletonRows count={3} />
			) : !person || !line ? (
				<p className="text-fg-2 text-small">{t("nothing")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<div className="flex items-center gap-3">
						<Face name={person.name ?? ""} />
						<p className="text-fg-2 text-small">
							{t.rich("owes", {
								name: first,
								amount: () => <Money value={line.amount} />,
							})}
						</p>
					</div>
					{lines.length > 1 ? (
						<Field label={t("currency")}>
							<EnvelopeSelect
								label={t("currency")}
								onChange={setCurrency}
								places={lines.map((l) => ({
									value: l.amount.currency,
									name: l.amount.currency,
									amount: l.amount,
								}))}
								value={line.amount.currency}
							/>
						</Field>
					) : null}
					<Field label={t("amount")}>
						<MoneyInput
							currency={line.amount.currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					<Field label={t("chargeTo")}>
						<EnvelopeSelect
							label={t("chargeTo")}
							onChange={setEnvelopeId}
							places={places}
							value={envelopeId}
						/>
					</Field>
					<FigureChanges dry={w.dry} poolName={pool} />
					<p className="text-fg-3 text-small">{t("effect", { name: first })}</p>
				</div>
			)}
		</Sheet>
	);
}
