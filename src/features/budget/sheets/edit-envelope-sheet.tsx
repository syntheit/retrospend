"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { CategoryChecks, useCategoryList } from "./category-checks";
import { EnvelopeEditChanges } from "./envelope-changes";
import { GroupSelect } from "./group-select";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { type EnvelopeInGroup, useMonth } from "./use-month";
import { newId } from "./use-write";

type UpdateInput = RouterInputs["envelope"]["updateEnvelope"];
type Args = SheetProps<{ envelopeId: string }>;

const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((x) => b.includes(x));

/** Rename an envelope, move it to a group, change the categories it covers. */
function EditForm({
	open,
	onClose,
	month,
	env,
	onArchive,
}: SheetProps & { env: EnvelopeInGroup; onArchive: () => void }) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const cats = useCategoryList(m.envelopes);
	const [name, setName] = useState(env.name);
	const [groupId, setGroupId] = useState<string | null>(env.groupId);
	const [categoryIds, setCategoryIds] = useState<string[]>(env.categoryIds);
	const [id] = useState(newId);
	const preview = api.envelope.updateEnvelopePreview.useMutation();
	const commit = api.envelope.updateEnvelope.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const edits = {
		...(name.trim() && name.trim() !== env.name ? { name: name.trim() } : {}),
		...(groupId !== env.groupId ? { groupId } : {}),
		...(!same(categoryIds, env.categoryIds) ? { categoryIds } : {}),
	};
	const input: UpdateInput | null =
		Object.keys(edits).length > 0 && name.trim()
			? { id, envelopeId: env.id, ...edits }
			: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { name: name.trim() }),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	return (
		<Sheet
			detent="large"
			footer={
				<>
					{env.isDefault ? null : (
						<Button kind="ghost" onClick={onArchive}>
							{t("archive")}
						</Button>
					)}
					<Button kind="secondary" onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button
						data-sheet-submit=""
						disabled={!w.ready}
						kind="primary"
						onClick={() =>
							void w.submit().then((r) => r !== false && onClose())
						}
					>
						{t("save")}
					</Button>
				</>
			}
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title", { name: env.name })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<Field label={t("name")}>
					<Input
						aria-label={t("name")}
						maxLength={64}
						onChange={(e) => setName(e.target.value)}
						value={name}
					/>
				</Field>
				<Field label={t("group")}>
					<GroupSelect
						groups={m.data?.groups ?? []}
						label={t("group")}
						onChange={setGroupId}
						value={groupId}
					/>
				</Field>
				<Field label={t("covers")}>
					<p className="text-fg-3 text-small">{t("coversNote")}</p>
					<CategoryChecks
						envelopes={m.envelopes}
						label={t("covers")}
						onChange={setCategoryIds}
						selfId={env.id}
						value={categoryIds}
					/>
				</Field>
				<EnvelopeEditChanges
					byId={m.byId}
					categoryNames={new Map(cats.list.map((c) => [c.id, c.name]))}
					dry={w.dry}
					fallbackName={t("fallback")}
					poolName={pool}
				/>
			</div>
		</Sheet>
	);
}

/** Archive an envelope: its leftover goes back, and the preview names what stops following it. */
function ArchiveForm({
	open,
	onClose,
	month,
	env,
	onBack,
}: SheetProps & { env: EnvelopeInGroup; onBack: () => void }) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const cats = useCategoryList(m.envelopes);
	const [id] = useState(newId);
	const preview = api.envelope.archiveEnvelopePreview.useMutation();
	const commit = api.envelope.archiveEnvelope.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const w = useMoneyWrite({
		input: { id, envelopeId: env.id },
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("archivedToast", { name: env.name }),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	const v = w.dry.preview?.value ?? null;
	return (
		<Sheet
			detent="medium"
			footer={
				<>
					<Button kind="secondary" onClick={onBack}>
						{t("back")}
					</Button>
					<Button
						data-sheet-submit=""
						disabled={!w.ready}
						kind="primary"
						onClick={() =>
							void w.submit().then((r) => r !== false && onClose())
						}
					>
						{t("archiveSave")}
					</Button>
				</>
			}
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("archiveTitle", { name: env.name })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("archiveLead", { pool })}</p>
				{v && v.rulesLeftOut.length > 0 ? (
					<Notice tone="attention">
						{t("rulesLeftOut", { count: v.rulesLeftOut.length })}
					</Notice>
				) : null}
				{v && v.projectRoutes.length > 0 ? (
					<Notice tone="info">
						{t("projectRoutes", { count: v.projectRoutes.length })}
					</Notice>
				) : null}
				<EnvelopeEditChanges
					byId={m.byId}
					categoryNames={new Map(cats.list.map((c) => [c.id, c.name]))}
					dry={w.dry}
					fallbackName={t("fallback")}
					poolName={pool}
				/>
			</div>
		</Sheet>
	);
}

/** Edit an envelope; Archive is a step of its own with its own preview. */
export function EditEnvelopeSheet(props: Args) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	const m = useMonth(props.month);
	const [archiving, setArchiving] = useState(false);
	const env = m.byId.get(props.envelopeId) ?? null;
	if (m.loading || !m.data || !env)
		return (
			<Sheet
				detent="large"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("loadingTitle")}
			>
				<SkeletonRows count={4} />
			</Sheet>
		);
	return archiving ? (
		<ArchiveForm {...props} env={env} onBack={() => setArchiving(false)} />
	) : (
		<EditForm {...props} env={env} onArchive={() => setArchiving(true)} />
	);
}
