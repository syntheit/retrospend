"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "~/components/layout/section";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Progress } from "~/components/ui/progress";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { settingsHref } from "~/lib/nav";
import type { RecentImport } from "~/server/services/import/recent";
import { api } from "~/trpc/react";
import type { CsvHeader, FileKind } from "./file";
import type { ReadAs } from "./use-import-flow";

type Option = { as: ReadAs; title: string; hint: string; off: boolean };

/** How to read the file: one option per reader, the default always one that works. */
function useOptions(kind: FileKind, header: CsvHeader | null) {
	const t = useTranslations("importPage.read");
	const importer = api.system.checkImporterStatus.useQuery();
	const ai = api.settings.getAiStatus.useQuery();
	const aiOff = importer.isSuccess && !importer.data.available;
	const csvOff = kind === "pdf" || (header != null && !header.retrospend);
	const options: Option[] = [
		{
			as: "CSV",
			title: t("csv"),
			hint:
				kind === "pdf" ? t("csvPdf") : csvOff ? t("csvMissing") : t("csvHint"),
			off: csvOff,
		},
		{
			as: "BANK_STATEMENT",
			title: t("ai"),
			hint: aiOff
				? t("aiOff")
				: ai.data?.currentMode === "EXTERNAL"
					? t("aiExternal")
					: t("aiLocal"),
			off: aiOff,
		},
	];
	return { options, aiOff, loading: importer.isPending };
}

/**
 * Read it (import.html step 2): a Retrospend CSV, or Let AI read it. A PDF
 * has only AI; with AI off it says so and links to the AI setting. Saved
 * mappings for a bank's own CSV are not built yet (GAPS).
 */
export function ReadStep({
	file,
	kind,
	header,
	starting,
	onBack,
	onRead,
}: {
	file: File;
	kind: FileKind;
	header: CsvHeader | null;
	starting: boolean;
	onBack: () => void;
	onRead: (as: ReadAs) => void;
}) {
	const t = useTranslations("importPage.read");
	const router = useRouter();
	const { options, aiOff } = useOptions(kind, header);
	const first = options.find((o) => !o.off)?.as ?? null;
	const [pick, setPick] = useState<ReadAs | null>(null);
	const chosen =
		pick && !options.find((o) => o.as === pick)?.off ? pick : first;
	return (
		<div className="max-w-190">
			<p className="text-fg-2 text-small mb-4">
				<span className="text-fg font-semibold">{file.name}</span>
			</p>
			{kind === "pdf" && aiOff ? (
				<Notice
					action={
						<Button
							kind="secondary"
							onClick={() => router.push(settingsHref("preferences"))}
							size="sm"
						>
							{t("aiSettings")}
						</Button>
					}
					className="mb-3"
					tone="attention"
				>
					{t("pdfBlocked")}
				</Notice>
			) : null}
			<div
				aria-label={t("label")}
				className="flex flex-col gap-2"
				role="radiogroup"
			>
				{options.map((o) => {
					const on = chosen === o.as;
					return (
						<Button
							aria-checked={on}
							aria-disabled={o.off}
							className={cn(
								"h-auto min-h-14 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal",
								on && "border-brand bg-brand-soft",
								o.off && "opacity-60",
							)}
							key={o.as}
							kind="secondary"
							onClick={() => !o.off && setPick(o.as)}
							role="radio"
						>
							<span
								aria-hidden="true"
								className={cn(
									"inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2",
									on ? "border-brand" : "border-line-strong",
								)}
							>
								{on ? <span className="bg-brand size-2 rounded-full" /> : null}
							</span>
							<span className="flex min-w-0 flex-col">
								<span className="text-body text-fg font-semibold">
									{o.title}
								</span>
								<span className="text-fg-3 text-meta font-normal">
									{o.hint}
								</span>
							</span>
						</Button>
					);
				})}
			</div>
			{chosen === "CSV" && header ? (
				<Section className="mt-6" title={t("columns")}>
					<RowList label={t("columns")}>
						{header.columns.map((c) => (
							<Row
								end={
									<span className="text-fg font-semibold">
										{t(`column.${c.column}`)}
									</span>
								}
								key={c.column}
								lead={
									<ArrowRight aria-hidden="true" className="text-fg-3 size-4" />
								}
								sub={
									<span className="text-fg-3 text-meta">
										{c.sample ?? t("notInFile")}
									</span>
								}
								title={c.sample == null ? t("notInFile") : c.column}
							/>
						))}
					</RowList>
				</Section>
			) : null}
			<div className="mt-6 flex flex-wrap items-center gap-2">
				<Button kind="ghost" onClick={onBack}>
					{t("back")}
				</Button>
				<span className="flex-1" />
				<Button
					disabled={!chosen}
					kind="primary"
					loading={starting}
					onClick={() => chosen && onRead(chosen)}
				>
					{chosen === "BANK_STATEMENT" ? t("readWithAi") : t("continue")}
				</Button>
			</div>
		</div>
	);
}

/** Reading: the job's progress; the page can be left, the job keeps reading. */
export function ReadingStep({
	name,
	job,
	onLeave,
	onCancel,
	cancelling,
}: {
	name: string;
	job: RecentImport | undefined;
	onLeave: () => void;
	onCancel: () => void;
	cancelling: boolean;
}) {
	const t = useTranslations("importPage.reading");
	const percent = job?.percent ?? null;
	return (
		<div className="max-w-190" data-testid="import-reading">
			<p className="text-fg text-section font-semibold">
				{t("title", { name })}
			</p>
			<Progress
				aria-label={t("title", { name })}
				className="my-3"
				value={percent ?? 0}
			/>
			<StatusDot
				kind="importing"
				label={
					job?.queued || !job
						? t("waiting")
						: percent != null
							? t("progress", { percent })
							: t("reading")
				}
				size="sm"
			/>
			<p className="text-fg-2 text-small mt-2">{t("leave")}</p>
			<div className="mt-6 flex flex-wrap items-center gap-2">
				{job?.queued ? (
					<Button kind="ghost" loading={cancelling} onClick={onCancel}>
						{t("cancel")}
					</Button>
				) : null}
				<span className="flex-1" />
				<Button kind="secondary" onClick={onLeave}>
					{t("back")}
				</Button>
			</div>
		</div>
	);
}
