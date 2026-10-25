"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { CategoryChecks, useCategoryList } from "./category-checks";
import { EnvelopeEditChanges } from "./envelope-changes";
import { GroupSelect } from "./group-select";
import { usePoolName } from "./pool";
import { TargetFields, useTargetDraft } from "./target-fields";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId } from "./use-write";

type CreateInput = RouterInputs["envelope"]["createEnvelope"];

function NewForm({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.envelopeNew");
	const te = useTranslations("budgetSheets.envelopeEdit");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const cats = useCategoryList(m.envelopes);
	const currency = m.data?.book.currency ?? "";
	const groups = m.data?.groups ?? [];
	const [name, setName] = useState("");
	const [groupId, setGroupId] = useState<string | null>(
		groups.find((g) => g.id !== null)?.id ?? null,
	);
	const [categoryIds, setCategoryIds] = useState<string[]>([]);
	const draft = useTargetDraft(
		currency,
		m.data?.today ?? "2000-01-01",
		null,
		"NONE",
	);
	const [id] = useState(newId);
	const preview = api.envelope.createEnvelopePreview.useMutation();
	const commit = api.envelope.createEnvelope.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const input: CreateInput | null =
		name.trim() && draft.complete
			? {
					id,
					name: name.trim(),
					groupId,
					kind: draft.kind,
					...(draft.input ? { target: draft.input } : {}),
					categoryIds,
				}
			: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (_r, i) => t("toast", { name: i.name }),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	const created = w.dry.preview?.value.envelopeId;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("add")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<Field label={te("name")}>
					<Input
						aria-label={te("name")}
						maxLength={64}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("namePlaceholder")}
						value={name}
					/>
				</Field>
				<Field label={te("group")}>
					<GroupSelect
						groups={groups}
						label={te("group")}
						onChange={setGroupId}
						value={groupId}
					/>
				</Field>
				<TargetFields draft={draft} />
				<Field label={te("covers")}>
					<p className="text-fg-3 text-small">{te("coversNote")}</p>
					<CategoryChecks
						envelopes={m.envelopes}
						label={te("covers")}
						onChange={setCategoryIds}
						value={categoryIds}
					/>
				</Field>
				<EnvelopeEditChanges
					byId={m.byId}
					categoryNames={new Map(cats.list.map((c) => [c.id, c.name]))}
					dry={w.dry}
					fallbackName={t("fallback")}
					names={created ? { [created]: name.trim() } : {}}
					poolName={pool}
				/>
			</div>
		</Sheet>
	);
}

/** Add an envelope: a name, its group, what it is for and the categories it covers. */
export function NewEnvelopeSheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.envelopeNew");
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
	return <NewForm {...props} />;
}
