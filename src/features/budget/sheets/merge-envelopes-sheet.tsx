"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Row, RowList } from "~/components/rows/row";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { useCategoryList } from "./category-checks";
import { EnvelopeEditChanges } from "./envelope-changes";
import { EnvelopeSelect, type Place } from "./envelope-select";
import { EnvelopeTile } from "./envelope-tile";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId } from "./use-write";

type MergeInput = RouterInputs["envelope"]["mergeEnvelopes"];

/**
 * Combine envelopes: the one you keep takes the others' money, categories,
 * rules and targets. The server previews every effect, the targets that
 * were added up and the ones that could not be, and Undo puts it all back.
 */
function MergeForm({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.merge");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const cats = useCategoryList(m.envelopes);
	const [into, setInto] = useState<string | null>(null);
	const [from, setFrom] = useState<string[]>([]);
	const [name, setName] = useState("");
	const [id] = useState(newId);
	const places = useMemo<Place[]>(
		() =>
			m.envelopes.map((e) => ({
				value: e.id,
				name: e.name,
				identity: e,
				amount: e.left,
			})),
		[m.envelopes],
	);
	const preview = api.envelope.mergeEnvelopesPreview.useMutation();
	const commit = api.envelope.mergeEnvelopes.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const chosen = from.filter((f) => f !== into);
	const input: MergeInput | null =
		into && chosen.length > 0
			? {
					id,
					intoId: into,
					fromIds: chosen,
					...(name.trim() ? { name: name.trim() } : {}),
				}
			: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (r) =>
			t("toast", {
				count: r.value.fromIds.length,
				name: name.trim() || (into ? (m.byId.get(into)?.name ?? "") : ""),
			}),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	const v = w.dry.preview?.value ?? null;
	const toggle = (envelopeId: string) =>
		setFrom((now) =>
			now.includes(envelopeId)
				? now.filter((x) => x !== envelopeId)
				: [...now, envelopeId],
		);
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("save")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("lead")}</p>
				<Field label={t("keep")}>
					<EnvelopeSelect
						label={t("keep")}
						onChange={setInto}
						placeholder={t("pick")}
						places={places}
						value={into}
					/>
				</Field>
				<Field label={t("from")}>
					<RowList label={t("from")} variant="flat">
						{m.envelopes
							.filter((e) => e.id !== into && !e.isDefault)
							.map((e) => (
								<Row
									key={e.id}
									lead={
										<span className="flex items-center gap-3">
											<Checkbox
												aria-label={e.name}
												checked={from.includes(e.id)}
												onCheckedChange={() => toggle(e.id)}
											/>
											<EnvelopeTile envelope={e} />
										</span>
									}
									title={e.name}
								/>
							))}
					</RowList>
				</Field>
				<Field label={t("name")}>
					<Input
						aria-label={t("name")}
						maxLength={64}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("namePlaceholder")}
						value={name}
					/>
				</Field>
				{v && v.target.dropped > 0 ? (
					<Notice tone="attention">
						{t("dropped", { count: v.target.dropped })}
					</Notice>
				) : null}
				{v?.payoffPlan ? <Notice tone="info">{t("payoff")}</Notice> : null}
				<EnvelopeEditChanges
					byId={m.byId}
					categoryNames={new Map(cats.list.map((c) => [c.id, c.name]))}
					dry={w.dry}
					extra={(p) => [
						...(p.value.target.summed > 0
							? [
									{
										key: "summed",
										label: t("summed"),
										value: t("summedCount", { count: p.value.target.summed }),
									},
								]
							: []),
						...(p.value.rules.length > 0
							? [
									{
										key: "rules",
										label: t("rules"),
										value: t("rulesCount", { count: p.value.rules.length }),
									},
								]
							: []),
					]}
					fallbackName={t("fallback")}
					poolName={pool}
				/>
			</div>
		</Sheet>
	);
}

/** Combine envelopes into one. */
export function MergeEnvelopesSheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.merge");
	const m = useMonth(props.month);
	if (m.loading || !m.data)
		return (
			<Sheet
				detent="large"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("title")}
			>
				<SkeletonRows count={4} />
			</Sheet>
		);
	return <MergeForm {...props} />;
}
