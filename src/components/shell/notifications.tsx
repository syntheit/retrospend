"use client";

import { Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Segmented } from "~/components/ui/segmented";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import { formatRelativeTimeCompact } from "~/lib/format";
import { badgeText } from "~/lib/nav";
import {
	NOTIFICATION_FILTERS,
	type ShellNotification,
} from "./notification-data";
import {
	useNotificationFeed,
	useUnreadNotifications,
} from "./use-notifications";

function NotificationRow({
	n,
	onOpen,
}: {
	n: ShellNotification;
	onOpen: () => void;
}) {
	const t = useTranslations("shell.notifications");
	const unread = !n.isRead;
	return (
		<Button
			className="h-auto w-full items-start justify-start gap-3 whitespace-normal px-2 py-3 text-left font-normal text-fg"
			kind="ghost"
			onClick={onOpen}
		>
			<span
				aria-hidden="true"
				className={cn(
					"mt-2 size-2 shrink-0 rounded-chip bg-brand",
					!unread && "invisible",
				)}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className={cn("text-body", unread && "font-semibold")}>
					{unread && <span className="sr-only">{t("unread")}: </span>}
					{n.title}
				</span>
				{n.body && (
					<span className="line-clamp-2 text-fg-2 text-small">{n.body}</span>
				)}
				<span className="text-fg-3 text-meta">
					{formatRelativeTimeCompact(n.createdAt)}
				</span>
			</span>
		</Button>
	);
}

/**
 * The notifications feed (account.html): the four filters, Mark all read and
 * the rows, newest first. Informational kinds only; a row opens its page.
 * Desktop shows it in the bell's popover, phones in a sheet.
 */
export function NotificationsPanel({
	open,
	onNavigate,
}: {
	open: boolean;
	onNavigate: () => void;
}) {
	const t = useTranslations("shell.notifications");
	const feed = useNotificationFeed(open, onNavigate);
	const options = NOTIFICATION_FILTERS.map((value) => ({
		value,
		label: t(`filter.${value}`),
	}));
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2 pb-2">
				<Segmented
					label={t("filterLabel")}
					onChange={feed.setFilter}
					options={options}
					value={feed.filter}
				/>
				<Button
					disabled={!feed.hasUnread}
					kind="ghost"
					loading={feed.markingAll}
					onClick={feed.markAllRead}
					size="sm"
				>
					{t("markAllRead")}
				</Button>
			</div>
			<div className="max-h-105 overflow-y-auto px-2 pb-2">
				{feed.isLoading ? (
					<SkeletonRows className="px-2" count={3} />
				) : feed.isError ? (
					<Empty
						action={
							<Button kind="secondary" onClick={feed.retry} size="sm">
								{t("retry")}
							</Button>
						}
						title={t("loadFailed")}
					/>
				) : feed.items.length === 0 ? (
					<Empty
						icon={BellOff}
						title={feed.total === 0 ? t("empty") : t("noMatches")}
					/>
				) : (
					feed.items.map((n) => (
						<NotificationRow
							key={n.id}
							n={n}
							onOpen={() => feed.openNotification(n)}
						/>
					))
				)}
			</div>
		</div>
	);
}

/** The count on the bell: attention, because unread notifications want a look. */
export function UnreadCount({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	const text = badgeText(count);
	if (!text) return null;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"min-w-4 rounded-chip bg-attention-bg px-1 text-center font-semibold text-attention-text text-meta tabular-nums leading-4",
				className,
			)}
		>
			{text}
		</span>
	);
}

/** The sidebar's bell: an icon button with the unread count and the popover. */
export function NotificationsButton() {
	const t = useTranslations("shell.notifications");
	const [open, setOpen] = useState(false);
	const unread = useUnreadNotifications();
	const label = unread ? t("labelUnread", { count: unread }) : t("title");
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tip content={t("title")}>
				<PopoverTrigger asChild>
					<Button
						aria-label={label}
						className="relative text-fg-3"
						icon
						kind="ghost"
						size="sm"
					>
						<Bell aria-hidden="true" />
						<UnreadCount className="absolute -top-1 -right-1" count={unread} />
					</Button>
				</PopoverTrigger>
			</Tip>
			<PopoverContent
				align="start"
				className="w-120 max-w-[calc(100vw-2rem)] rounded-panel border-line bg-surface p-0 text-fg shadow-menu"
				side="right"
				sideOffset={8}
			>
				<h2 className="px-4 pt-3 font-semibold text-body">{t("title")}</h2>
				<NotificationsPanel onNavigate={() => setOpen(false)} open={open} />
			</PopoverContent>
		</Popover>
	);
}
