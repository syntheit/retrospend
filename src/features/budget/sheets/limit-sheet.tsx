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
import { EnvelopeSelect, type Place } from "./envelope-select";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type SetLimitInput = RouterInputs["envelope"]["setLimit"];
type Scope = SetLimitInput["scope"];

/**
 * A limit (SPEC §5.6): what an envelope may spend this month or from now on.
 * Raising one and setting one are the same write (`setLimit`), previewed by
 * the server and undone by `revertLimit`, which restores every stored target
 * column exactly. Other limits stay as they are.
 */
function LimitSheet({
	open,
	onClose,
	month,
	fixedEnvelopeId,
	startEnvelopeId,
}: SheetProps & { fixedEnvelopeId?: string; startEnvelopeId?: string }) {
	const t = useTranslations("budgetSheets.limit");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const currency = m.data?.book.currency ?? "";
	const [picked, setPicked] = useState<string | null>(startEnvelopeId ?? null);
	const envelopeId = fixedEnvelopeId ?? picked;
	const env = envelopeId ? (m.byId.get(envelopeId) ?? null) : null;
	// The current limit (the monthly target) is the starting point.
	const current = env?.target?.kind === "MONTHLY" ? env.target.amount : null;
	const amount = useAmount(currency, current?.minor ?? null);
	const [scope, setScope] = useState<Scope>("THIS_MONTH");
	const [id] = useState(newId);

	const places = useMemo<Place[]>(
		() =>
			m.envelopes
				.filter((e) => e.kind === "MONTHLY" || e.kind === "NONE")
				.map((e) => ({
					value: e.id,
					name: e.name,
					identity: e,
					amount: e.left,
				})),
		[m.envelopes],
	);
	const preview = api.envelope.setLimitPreview.useMutation();
	const commit = api.envelope.setLimit.useMutation();
	const revert = api.envelope.revertLimit.useMutation();
	const input: SetLimitInput | null =
		envelopeId && amount.minor !== null
			? { id, envelopeId, amountMinor: amount.minor, scope }
			: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (r, i) =>
			t(i.scope === "THIS_MONTH" ? "toastMonth" : "toastAlways", {
				name: env?.name ?? "",
				amount: money(r.value.limit),
			}),
		undo: (_r, i) => () =>
			revert.mutateAsync({ id: newId(), envelopeId: i.envelopeId }),
	});

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={fixedEnvelopeId ? t("raise") : t("set")}
			title={fixedEnvelopeId ? t("raiseTitle") : t("setTitle")}
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					{fixedEnvelopeId ? null : (
						<Field label={t("envelope")}>
							<EnvelopeSelect
								label={t("envelope")}
								onChange={setPicked}
								placeholder={t("pick")}
								places={places}
								value={picked}
							/>
						</Field>
					)}
					{env ? (
						<p className="text-fg-2 text-small">
							{t.rich("spent", {
								name: env.name,
								spent: () => <Money sign="never" value={env.activity} />,
								limit: () => <Money value={current} />,
							})}
						</p>
					) : null}
					<Field label={t("newLimit")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					<Segmented
						label={t("when")}
						onChange={setScope}
						options={[
							{ value: "THIS_MONTH", label: t("thisMonth") },
							{ value: "FROM_NOW_ON", label: t("fromNowOn") },
						]}
						value={scope}
					/>
					<MovementChanges
						byId={m.byId}
						dry={w.dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
					<p className="text-fg-3 text-small">{t("others")}</p>
				</div>
			)}
		</Sheet>
	);
}

export function RaiseLimitSheet(props: SheetProps<{ envelopeId: string }>) {
	return <LimitSheet {...props} fixedEnvelopeId={props.envelopeId} />;
}

export function SetLimitSheet(props: SheetProps<{ envelopeId?: string }>) {
	return <LimitSheet {...props} startEnvelopeId={props.envelopeId} />;
}
