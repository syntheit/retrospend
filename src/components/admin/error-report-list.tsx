"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { type ErrorReportItem, ErrorReportSheet } from "./error-report-sheet";
import { firstLine } from "./feedback-parts";

export function ErrorReportList() {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	const now = useNow();
	const toast = useToast();
	const utils = api.useUtils();
	const [openId, setOpenId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ErrorReportItem | null>(null);

	const query = api.feedback.errorReports.useInfiniteQuery(
		{ limit: 20 },
		{ getNextPageParam: (last) => last.nextCursor },
	);
	const items = query.data?.pages.flatMap((p) => p.items) ?? [];
	const open = items.find((i) => i.id === openId) ?? null;

	const remove = api.feedback.deleteErrorReport.useMutation({
		onSuccess: () => {
			void utils.feedback.errorReports.invalidate();
			setDeleting(null);
			setOpenId(null);
			toast.saved(t("reportDeleted"));
		},
		onError: () => toast.failed(t("failed")),
	});

	if (query.isLoading) return <SkeletonRows count={5} />;
	if (query.isError)
		return (
			<Empty
				action={
					<Button
						kind="secondary"
						onClick={() => void query.refetch()}
						size="sm"
					>
						{t("retry")}
					</Button>
				}
				title={t("loadFailed")}
			/>
		);
	if (items.length === 0) return <Empty title={t("emptyErrors")} />;

	const kindWord = (kind: string) =>
		kind === "crash" || kind === "rejection" || kind === "render"
			? t(`kind.${kind}`)
			: kind;

	return (
		<>
			<RowList label={t("view.errors")}>
				{items.map((item) => (
					<Row
						key={item.id}
						open={{
							label: t("openReport", { message: firstLine(item.message) }),
							onOpen: () => setOpenId(item.id),
						}}
						sub={
							<RowSub
								parts={[
									kindWord(item.kind),
									{ shrink: item.screen },
									item.appVersion
										? item.build
											? t("versionBuild", {
													version: item.appVersion,
													build: item.build,
												})
											: item.appVersion
										: null,
									item.os,
									format.relativeTime(item.createdAt, now),
								]}
							/>
						}
						title={firstLine(item.message)}
					/>
				))}
			</RowList>
			{query.hasNextPage ? (
				<div className="flex justify-center pt-4">
					<Button
						kind="secondary"
						loading={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{t("loadMore")}
					</Button>
				</div>
			) : null}
			{open ? (
				<ErrorReportSheet
					item={open}
					key={open.id}
					onDelete={() => setDeleting(open)}
					onOpenChange={(o) => !o && setOpenId(null)}
				/>
			) : null}
			<ConfirmationDialog
				confirmLabel={t("delete")}
				description={t("deleteReportBody")}
				isLoading={remove.isPending}
				onCancel={() => setDeleting(null)}
				onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
				onOpenChange={(o) => !o && setDeleting(null)}
				open={deleting !== null}
				title={t("deleteReportTitle")}
				variant="destructive"
			/>
		</>
	);
}
