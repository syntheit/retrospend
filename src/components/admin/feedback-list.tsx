"use client";

import { MessageSquare } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { useToast } from "~/components/ui/toast";
import { getImageUrl } from "~/lib/image-url";
import { api } from "~/trpc/react";
import {
	diagnosticsOf,
	firstLine,
	pageName,
	platformOf,
} from "./feedback-parts";
import {
	type FeedbackItem,
	FeedbackSheet,
	type FeedbackStatus,
} from "./feedback-sheets";

export type Filter = "all" | FeedbackStatus;

const STATUS_DOT = {
	unread: "review",
	read: "confirmed",
	archived: "settled",
} as const;

export function FeedbackList({ filter }: { filter: Filter }) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	const now = useNow();
	const toast = useToast();
	const utils = api.useUtils();
	const [openId, setOpenId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<FeedbackItem | null>(null);

	const query = api.feedback.list.useInfiniteQuery(
		{ status: filter === "all" ? undefined : filter, limit: 20 },
		{ getNextPageParam: (last) => last.nextCursor },
	);
	const items = query.data?.pages.flatMap((p) => p.items) ?? [];
	const open = items.find((i) => i.id === openId) ?? null;

	const refresh = () => {
		void utils.feedback.list.invalidate();
		void utils.feedback.unreadCount.invalidate();
	};
	const updateStatus = api.feedback.updateStatus.useMutation({
		onSuccess: refresh,
		onError: () => toast.failed(t("failed")),
	});
	const addNote = api.feedback.addNote.useMutation({
		onSuccess: refresh,
		onError: () => toast.failed(t("failed")),
	});
	const remove = api.feedback.delete.useMutation({
		onSuccess: () => {
			refresh();
			setDeleting(null);
			setOpenId(null);
			toast.saved(t("deleted"));
		},
		onError: () => toast.failed(t("failed")),
	});

	const move = (item: FeedbackItem, status: FeedbackStatus) => {
		const from = item.status as FeedbackStatus;
		updateStatus.mutate(
			{ id: item.id, status },
			{
				onSuccess: () => {
					toast.saved(t(`moved.${status}`), {
						undo: () => updateStatus.mutateAsync({ id: item.id, status: from }),
					});
				},
			},
		);
	};

	if (query.isLoading) return <SkeletonRows count={5} />;
	if (query.isError)
		return (
			<Empty
				action={
					<Button kind="secondary" onClick={() => void query.refetch()} size="sm">
						{t("retry")}
					</Button>
				}
				title={t("loadFailed")}
			/>
		);
	if (items.length === 0)
		return (
			<Empty
				hint={filter === "all" ? t("emptyHint") : undefined}
				icon={MessageSquare}
				title={filter === "all" ? t("empty") : t("emptyFiltered")}
			/>
		);

	return (
		<>
			<RowList label={t("title")}>
				{items.map((item) => {
					const diagnostics = diagnosticsOf(item.diagnostics);
					const platform = platformOf({
						userAgent: item.userAgent,
						diagnostics,
					});
					const version = item.appVersion
						? diagnostics?.build
							? t("versionBuild", {
									version: item.appVersion,
									build: diagnostics.build,
								})
							: item.appVersion
						: null;
					const status = item.status as FeedbackStatus;
					return (
						<Row
							end={
								<StatusDot
									kind={STATUS_DOT[status]}
									label={t(`status.${status}`)}
									size="sm"
								/>
							}
							lead={
								<Face
									imageUrl={
										item.user.avatarPath
											? getImageUrl(item.user.avatarPath)
											: item.user.image
									}
									name={item.user.name}
								/>
							}
							key={item.id}
							open={{
								label: t("openEntry", { name: item.user.name }),
								onOpen: () => setOpenId(item.id),
							}}
							sub={
								<RowSub
									parts={[
										item.user.name,
										t(`category.${item.category === "bug" || item.category === "idea" ? item.category : "other"}`),
										{ shrink: pageName(item.pageUrl) },
										version,
										platform === "web"
											? t("web")
											: platform
												? platform.os
												: null,
										format.relativeTime(item.createdAt, now),
									]}
								/>
							}
							title={firstLine(item.message)}
						/>
					);
				})}
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
				<FeedbackSheet
					item={open}
					key={open.id}
					onDelete={() => setDeleting(open)}
					onOpenChange={(o) => !o && setOpenId(null)}
					onSaveNote={async (note) => {
						await addNote.mutateAsync({ id: open.id, note });
						toast.saved(t("noteSaved"));
					}}
					onStatus={(status) => move(open, status)}
				/>
			) : null}
			<ConfirmationDialog
				confirmLabel={t("delete")}
				isLoading={remove.isPending}
				onCancel={() => setDeleting(null)}
				onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
				onOpenChange={(o) => !o && setDeleting(null)}
				open={deleting !== null}
				title={t("deleteTitle")}
				variant="destructive"
			/>
		</>
	);
}
