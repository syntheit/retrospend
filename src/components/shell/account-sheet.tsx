"use client";

import { Bell, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { entryOf, type NavEntry, PHONE_GO_TO } from "~/lib/nav";
import { APP_VERSION } from "~/lib/version";
import { AccountIdentity } from "./account-menu";
import { useShellActions } from "./shell-context";
import {
	type AccountEntry,
	accountGroups,
	useAccountEntries,
} from "./use-account";
import { useUnreadNotifications } from "./use-notifications";

const ROW =
	"flex h-auto min-h-row w-full items-center justify-start gap-3 rounded-none px-3 py-2 font-normal text-body text-fg";
// Button asChild cannot wrap a link here (KindButton adds a second child for
// its spinner, which Slot refuses), so links take the ghost row look directly.
const LINK_ROW = `${ROW} transition-colors duration-(--t-state) ease-land can-hover:hover:bg-raised focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2`;
const GROUP =
	"flex flex-col divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface";

function Row({
	icon,
	label,
	end,
	href,
	newTab,
	onSelect,
	chevron,
	close,
}: {
	icon: ReactNode;
	label: ReactNode;
	end?: ReactNode;
	href?: string;
	newTab?: boolean;
	onSelect?: () => void;
	/** A row that opens another sheet shows the chevron too. */
	chevron?: boolean;
	close: () => void;
}) {
	const body = (
		<>
			{icon != null && (
				<span className="flex size-8 shrink-0 items-center justify-center rounded-ctl bg-raised text-fg-2">
					{icon}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			{end}
			{(href || chevron) && (
				<ChevronRight aria-hidden="true" className="size-4 text-fg-3" />
			)}
		</>
	);
	if (href)
		return (
			<Link
				className={LINK_ROW}
				href={href}
				onClick={close}
				rel={newTab ? "noopener noreferrer" : undefined}
				target={newTab ? "_blank" : undefined}
			>
				{body}
			</Link>
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

function EntryRow({
	entry,
	close,
}: {
	entry: AccountEntry;
	close: () => void;
}) {
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

const GO_TO: NavEntry[] = PHONE_GO_TO.map(entryOf);

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
		<Sheet
			detent="large"
			footer={false}
			onOpenChange={onOpenChange}
			open={open}
			title={t("account.title")}
		>
			<div className="flex flex-col gap-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
				<div className="flex flex-col">
					<Row
						close={close}
						href={e.profile?.href}
						icon={null}
						label={
							<span className="flex items-center gap-3">
								<AccountIdentity size="md" />
							</span>
						}
					/>
				</div>
				<div className={GROUP}>
					<Row
						close={close}
						end={<NewCount count={unread} />}
						icon={<Bell aria-hidden="true" className="size-4" />}
						chevron
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
									href={entry.href}
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
			</div>
		</Sheet>
	);
}
