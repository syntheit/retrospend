"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api, type RouterInputs } from "~/trpc/react";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import { TargetFields, useTargetDraft } from "./target-fields";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId } from "./use-write";

type SetTargetInput = RouterInputs["envelope"]["setTarget"];

/** The form, mounted once the envelope and the month are read so its fields start from them. */
function TargetForm({
	open,
	onClose,
	month,
	envelopeId,
}: SheetProps<{ envelopeId: string }>) {
	const t = useTranslations("budgetSheets.target");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const env = m.byId.get(envelopeId) ?? null;
	const currency = m.data?.book.currency ?? "";
	const draft = useTargetDraft(currency, m.data?.today ?? "2000-01-01", env);
	const [id] = useState(newId);
	const preview = api.envelope.setTargetPreview.useMutation();
	const commit = api.envelope.setTarget.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const input: SetTargetInput | null = draft.complete
		? { id, envelopeId, kind: draft.kind, target: draft.input }
		: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { name: env?.name ?? "" }),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	const value = w.dry.preview?.value ?? null;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("save")}
			title={t("title", { name: env?.name ?? "" })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<TargetFields draft={draft} />
				{value?.incomplete ? (
					<Notice tone="attention">{t("noRate")}</Notice>
				) : null}
				<FigureChanges
					dry={w.dry}
					own={(p) => {
						const v = p.value;
						return [
							{
								key: "target",
								label: t("line"),
								value: v.typed ? <Money value={v.typed} /> : t("lineNone"),
							},
							...(v.typed && v.inBook && v.typed.currency !== v.inBook.currency
								? [
										{
											key: "inBook",
											label: t("lineInBook"),
											value: <Money value={v.inBook} />,
										},
									]
								: []),
						];
					}}
					poolName={pool}
				/>
			</div>
		</Sheet>
	);
}

/** An envelope's target: what it is for and how much, previewed and undone by the server. */
export function TargetSheet(props: SheetProps<{ envelopeId: string }>) {
	const t = useTranslations("budgetSheets.target");
	const m = useMonth(props.month);
	if (m.loading || !m.data)
		return (
			<Sheet
				detent="large"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("titleShort")}
			>
				<SkeletonRows count={4} />
			</Sheet>
		);
	return <TargetForm {...props} />;
}
