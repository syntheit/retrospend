"use client";

import { Archive, Download, EllipsisIcon, Settings2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BudgetsImporterTab } from "~/components/data-management/budgets-importer-tab";
import { WealthImporterTab } from "~/components/data-management/wealth-importer-tab";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import { useToast } from "~/components/ui/toast";
import { BackButton, PageFrame } from "~/features/wealth/page-frame";
import { settingsHref } from "~/lib/nav";
import type { ImportSummary } from "~/server/services/import/commit.mutation";
import { api } from "~/trpc/react";
import { DoneStep } from "./done-step";
import { DropZone } from "./drop-zone";
import { TEMPLATE_CSV } from "./file";
import { ReadingStep, ReadStep } from "./read-step";
import { RecentImports } from "./recent-imports";
import { ReviewStep } from "./review-step";
import { Stepper } from "./stepper";
import { type Flow, useImportFlow } from "./use-import-flow";

type ImportType = "expenses" | "accounts" | "budgets";

const STEP_OF: Record<Flow["step"], number> = {
	choose: 1,
	read: 2,
	reading: 2,
	review: 3,
	done: 4,
};

function saveTemplate() {
	const url = URL.createObjectURL(
		new Blob([TEMPLATE_CSV], { type: "text/csv" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = "retrospend-template.csv";
	a.click();
	URL.revokeObjectURL(url);
}

function Overflow() {
	const t = useTranslations("importPage");
	const router = useRouter();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button aria-label={t("more")} icon kind="ghost">
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={saveTemplate}>
					<Download aria-hidden="true" />
					{t("menu.template")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => router.push(settingsHref("data"))}>
					<Archive aria-hidden="true" />
					{t("menu.export")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => router.push(settingsHref("preferences"))}
				>
					<Settings2 aria-hidden="true" />
					{t("menu.ai")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Import (import.html): one flat page in four steps. Choose a file (or open
 * one from Recent imports), read it, review its rows and import them as one
 * batch that Undo takes back. Accounts and Budgets keep today's importers.
 */
export function ImportPage() {
	const t = useTranslations("importPage");
	const toast = useToast();
	const params = useSearchParams();
	const f = useImportFlow(params.get("job"));
	const { flow, setFlow } = f;
	const [type, setType] = useState<ImportType>("expenses");
	const utils = api.useUtils();
	const cancel = api.importQueue.cancelJob.useMutation();
	const drop = api.importQueue.deleteJob.useMutation();
	const undo = api.importQueue.undo.useMutation({
		onSuccess: () => void utils.importQueue.recent.invalidate(),
	});

	const undoImport = async (jobId: string) => {
		await undo.mutateAsync({ jobId });
		setFlow({ step: "review", jobId });
	};
	const imported = (s: ImportSummary) => {
		setFlow({ step: "done", summary: s });
		void utils.importQueue.recent.invalidate();
		toast.saved(t("done.toast", { count: s.created }), {
			undo: () => undoImport(s.jobId),
		});
	};

	let body: React.ReactNode;
	if (flow.step === "read")
		body = (
			<ReadStep
				file={flow.file}
				header={flow.header}
				kind={flow.kind}
				onBack={() => setFlow({ step: "choose" })}
				onRead={(as) => void f.start(flow.file, flow.kind, as)}
				starting={f.starting}
			/>
		);
	else if (flow.step === "reading")
		body = (
			<ReadingStep
				cancelling={cancel.isPending}
				job={f.recent.data?.find((j) => j.id === flow.jobId)}
				name={flow.name}
				onCancel={() =>
					cancel.mutate(
						{ jobId: flow.jobId },
						{ onSuccess: () => setFlow({ step: "choose" }) },
					)
				}
				onLeave={() => setFlow({ step: "choose" })}
			/>
		);
	else if (flow.step === "review")
		body = (
			<ReviewStep
				jobId={flow.jobId}
				onBack={() => setFlow({ step: "choose" })}
				onImported={imported}
				onReread={
					flow.file
						? () => {
								const file = flow.file as File;
								drop.mutate({ jobId: flow.jobId });
								setFlow({ step: "choose" });
								void f.accept(file, { ask: true });
							}
						: null
				}
			/>
		);
	else if (flow.step === "done")
		body = (
			<DoneStep
				onAgain={() => setFlow({ step: "choose" })}
				onUndo={() =>
					void undoImport(flow.summary.jobId).then(
						() => toast.info(t("done.undone")),
						(e: unknown) =>
							toast.failed(
								e instanceof Error
									? t("done.undoFailedWhy", { reason: e.message })
									: t("done.undoFailed"),
							),
					)
				}
				summary={flow.summary}
				undoing={undo.isPending}
			/>
		);
	else
		body = (
			<div className="max-w-190">
				<div className="mb-4">
					<Segmented
						label={t("type.label")}
						onChange={setType}
						options={[
							{ value: "expenses", label: t("type.expenses") },
							{ value: "accounts", label: t("type.accounts") },
							{ value: "budgets", label: t("type.budgets") },
						]}
						value={type}
					/>
				</div>
				{type === "accounts" ? (
					<WealthImporterTab />
				) : type === "budgets" ? (
					<BudgetsImporterTab />
				) : (
					<>
						<DropZone
							busy={f.starting}
							onFile={(file) => void f.accept(file)}
						/>
						{f.error ? (
							<Notice className="mt-3" tone="danger">
								{f.error}
							</Notice>
						) : null}
						<RecentImports
							failed={f.recent.isError}
							jobs={f.recent.data}
							loading={f.recent.isPending}
							onReview={(job) => setFlow({ step: "review", jobId: job.id })}
						/>
					</>
				)}
			</div>
		);

	return (
		<PageFrame label="import">
			<PageHeader
				lead={<BackButton href="/activity" label={t("back")} />}
				overflow={<Overflow />}
				sub={t("sub")}
				title={t("title")}
			/>
			<Stepper current={STEP_OF[flow.step]} />
			{body}
		</PageFrame>
	);
}
