"use client";

import { MessageSquare } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Empty } from "~/components/ui/empty-state";
import { Segmented } from "~/components/ui/segmented";
import { SkeletonRows } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { useToast } from "~/components/ui/toast";
import { Toolbar } from "~/components/layout/toolbar";
import { getImageUrl } from "~/lib/image-url";
import { api } from "~/trpc/react";
import {
	diagnosticsOf,
	firstLine,
	pageName,
	platformOf,
} from "./feedback-parts";
import {
	type ErrorReportItem,
	ErrorReportSheet,
	type FeedbackItem,
	FeedbackSheet,
	type FeedbackStatus,
} from "./feedback-sheets";

type View = "feedback" | "errors";
type Filter = "all" | FeedbackStatus;
const FILTERS: Filter[] = ["all", "unread", "read", "archived"];

const STATUS_DOT = {
	unread: "review",
	read: "confirmed",
	archived: "settled",
} as const;

/**
 * The admin inbox for what the apps send: feedback (with its screenshot and
 * the errors the person attached) and the error reports phones sent on their
 * own. Newest first. A row opens a Sheet to read, mark read, archive, note or
 * delete. Screenshots load from an admin-only route.
 */
export function FeedbackInbox() {
	const t = useTranslations("feedbackInbox");
	const [view, setView] = useState<View>("feedback");
	const [filter, setFilter] = useState<Filter>("unread");
	return (
		<div>
			<Toolbar
				end={
					<Segmented
						label={t("viewLabel")}
						onChange={setView}
						options={[
							{ value: "feedback", label: t("view.feedback") },
							{ value: "errors", label: t("view.errors") },
						]}
						value={view}
					/>
				}
				label={t("filterLabel")}
			>
				{view === "feedback" ? (
					<StatusChips filter={filter} setFilter={setFilter} />
				) : null}
			</Toolbar>
			{view === "feedback" ? (
				<FeedbackList filter={filter} />
			) : (
				<ErrorReportList />
			)}
		</div>
	);
}

function StatusChips({
	filter,
	setFilter,
}: {
	filter: Filter;
	setFilter: (f: Filter) => void;
}) {
	const t = useTranslations("feedbackInbox");
	const { data } = api.feedback.list.useQuery({ limit: 1 });
	const counts = data?.counts;
	return (
		<FilterChips label={t("filterLabel")}>
			{FILTERS.map((id) => (
				<FilterChip
					key={id}
					onClick={() => setFilter(id)}
					selected={filter === id}
				>
					{t(`status.${id}`)}
					{counts ? (
						<span className="text-fg-3 tabular-nums">
							{id === "all" ? counts.total : counts[id]}
						</span>
					) : null}
				</FilterChip>
			))}
		</FilterChips>
	);
}

function FeedbackList({ filter }: { filter: Filter }) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
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
										format.relativeTime(item.createdAt),
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
				description={t("deleteBody")}
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

function ErrorReportList() {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
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
					<Button kind="secondary" onClick={() => void query.refetch()} size="sm">
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
									format.relativeTime(item.createdAt),
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
