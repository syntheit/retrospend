"use client";

import { Bell, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
	DESTINATIONS,
	hrefOf,
	type NavEntry,
	PLACES,
	TOOLS,
} from "~/lib/nav";
import { APP_VERSION } from "~/lib/version";
import { AccountIdentity } from "./account-menu";
import { useShellActions } from "./shell-context";
import { type AccountEntry, accountGroups, useAccountEntries } from "./use-account";
import { useUnreadNotifications } from "./use-notifications";

const ROW =
	"flex h-auto min-h-row w-full items-center justify-start gap-3 rounded-none px-3 py-2 font-normal text-body text-fg";
const GROUP =
	"flex flex-col divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface";

function Row({
	icon,
	label,
	end,
	href,
	newTab,
	onSelect,
	close,
}: {
	icon: ReactNode;
	label: ReactNode;
	end?: ReactNode;
	href?: string;
	newTab?: boolean;
	onSelect?: () => void;
	close: () => void;
}) {
	const body = (
		<>
			{icon != null && (
				<span className="flex size-6 shrink-0 items-center justify-center text-fg-2">
					{icon}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			{end}
			{href && <ChevronRight aria-hidden="true" className="text-fg-3" />}
		</>
	);
	if (href)
		return (
			<Button asChild className={ROW} kind="ghost">
				<Link
					href={href}
					onClick={close}
					rel={newTab ? "noopener noreferrer" : undefined}
					target={newTab ? "_blank" : undefined}
				>
					{body}
				</Link>
			</Button>
		);
	return (
		<Button
			className={ROW}
			kind="ghost"
			onClick={() => {
				close();
				onSelect?.();
			}}
		>
			{body}
		</Button>
	);
}

function NewCount({ count }: { count: number }) {
	const t = useTranslations("shell.account");
	if (!count) return null;
	return (
		<span className="font-medium text-attention-text text-meta">
			{t("newCount", { count })}
		</span>
	);
}

function EntryRow({ entry, close }: { entry: AccountEntry; close: () => void }) {
	const Icon = entry.icon;
	return (
		<Row
			close={close}
			end={entry.count ? <NewCount count={entry.count} /> : undefined}
			href={entry.href}
			icon={<Icon aria-hidden="true" className="size-4" />}
			label={entry.label}
			newTab={entry.newTab}
			onSelect={entry.onSelect}
		/>
	);
}

/** Wealth, the tools and Settings: phones have no global search (N65). */
const GO_TO: NavEntry[] = [
	...DESTINATIONS.filter((d) => d.id === "wealth"),
	...TOOLS,
	...PLACES.filter((p) => p.id === "settings"),
];

/**
 * The phone account sheet (account.html): who you are, notifications, Go to
 * for the places without a tab, the account entries, Sign out and the version.
 */
export function AccountSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("shell");
	const e = useAccountEntries();
	const { openNotificationsSheet } = useShellActions();
	const unread = useUnreadNotifications();
	const close = () => onOpenChange(false);
	const groups = accountGroups([
		[e.admin, e.invites, e.inbox],
		[e.feedback, e.docs, e.releases],
		[e.signOut],
	]);
	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent className="gap-4 rounded-t-panel border-line bg-bg px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-fg">
				<ResponsiveDialogHeader className="p-0">
					<ResponsiveDialogTitle className="text-section">
						{t("account.title")}
					</ResponsiveDialogTitle>
				</ResponsiveDialogHeader>
				<div className={GROUP}>
					<Row
						close={close}
						href={e.profile?.href}
						icon={null}
						label={
							<span className="flex items-center gap-3">
								<AccountIdentity />
							</span>
						}
					/>
				</div>
				<div className={GROUP}>
					<Row
						close={close}
						end={<NewCount count={unread} />}
						icon={<Bell aria-hidden="true" className="size-4" />}
						label={t("notifications.title")}
						onSelect={openNotificationsSheet}
					/>
				</div>
				<section className="flex flex-col gap-1">
					<h3 className="px-1 text-fg-3 text-meta">{t("account.goTo")}</h3>
					<div className={GROUP}>
						{GO_TO.map((entry) => {
							const Icon = entry.icon;
							return (
								<Row
									close={close}
									href={hrefOf(entry) ?? undefined}
									icon={<Icon aria-hidden="true" className="size-4" />}
									key={entry.id}
									label={t(`nav.${entry.id}`)}
								/>
							);
						})}
					</div>
				</section>
				{groups.map((group) => (
					<div className={GROUP} key={group[0]?.id}>
						{group.map((entry) => (
							<EntryRow close={close} entry={entry} key={entry.id} />
						))}
					</div>
				))}
				<p className="text-center text-fg-3 text-meta">
					{t("account.version", { version: APP_VERSION })}
				</p>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
