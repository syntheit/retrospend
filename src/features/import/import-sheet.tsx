"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Sheet } from "~/components/ui/sheet";
import { ChangesBlock } from "~/features/entry/changes";
import type { ImportSummary } from "~/server/services/import/commit.mutation";
import type { ImportKind } from "~/server/services/import/rows";
import { api, type RouterInputs } from "~/trpc/react";

export type CommitInput = RouterInputs["importQueue"]["commit"];

/** The figure id of a kind's total in the sheet (e2e audit vs the preview). */
export const createdFigure = (kind: ImportKind) => `import.created.${kind}`;

/** What the write itself creates and skips: every row of the file in one line. */
function SummaryLines({ s }: { s: ImportSummary }) {
	const t = useTranslations("importPage.sheet");
	const k = useTranslations("importPage.kindCount");
	const skipped = [
		s.duplicates ? t("skipDups", { count: s.duplicates }) : null,
		s.unchecked ? t("skipUnchecked", { count: s.unchecked }) : null,
		s.unreadable ? t("skipUnreadable", { count: s.unreadable }) : null,
		s.noRate ? t("skipNoRate", { count: s.noRate }) : null,
	].filter(Boolean);
	return (
		<div className="flex flex-col gap-1" data-testid="import-summary">
			{s.byKind.map((line) => (
				<div
					className="text-small flex min-h-6 items-baseline justify-between gap-3"
					data-kind={line.kind}
					key={line.kind}
				>
					<span className="text-fg-2">
						{k(line.kind, { count: line.count })}
						{line.withoutRate
							? ` · ${t("withoutRate", { count: line.withoutRate })}`
							: ""}
					</span>
					<Money
						figure={createdFigure(line.kind)}
						missing="noRate"
						value={line.total}
					/>
				</div>
			))}
			{skipped.length > 0 ? (
				<p className="text-fg-2 text-small">
					{t("skipped", { list: skipped.join(", ") })}
				</p>
			) : null}
			<p className="text-fg-3 text-meta" data-file-rows={s.fileRows}>
				{t("reconcile", {
					rows: s.fileRows,
					created: s.created,
					skipped: s.fileRows - s.created,
				})}
			</p>
		</div>
	);
}

/**
 * The Import sheet (R30): before anything is written, the server's dry run
 * of the same commit lists what it creates per kind, what it skips and what
 * that does to your figures. Import writes exactly that.
 */
export function ImportSheet({
	open,
	onOpenChange,
	input,
	fileName,
	count,
	onImported,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	input: CommitInput;
	fileName: string;
	count: number;
	onImported: (summary: ImportSummary) => void;
}) {
	const t = useTranslations("importPage.sheet");
	const preview = api.importQueue.commitPreview.useQuery(input, {
		enabled: open,
		staleTime: 0,
		gcTime: 0,
	});
	const commit = api.importQueue.commit.useMutation();
	const data = preview.data;
	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={async () => {
				const res = await commit.mutateAsync(input);
				onImported(res.value);
			}}
			open={open}
			submitDisabled={!data || data.value.created === 0}
			submitLabel={t("submit", { count })}
			title={t("title", { file: fileName })}
		>
			<div className="flex flex-col gap-4 pb-2">
				{data ? <SummaryLines s={data.value} /> : null}
				<ChangesBlock
					cannot={preview.error ? preview.error.message : null}
					diff={data ?? null}
					empty={t("loading")}
					loading={preview.isPending}
				/>
			</div>
		</Sheet>
	);
}
