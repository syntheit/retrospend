"use client";

import { EllipsisVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment } from "react";
import { Face, type FaceSize } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { APP_VERSION } from "~/lib/version";
import {
	type AccountEntry,
	accountGroups,
	useAccountEntries,
	useAccountUser,
} from "./use-account";

function EntryInner({ entry }: { entry: AccountEntry }) {
	const t = useTranslations("shell.account");
	const Icon = entry.icon;
	return (
		<>
			<Icon aria-hidden="true" className="size-4" />
			{entry.label}
			{entry.count ? (
				<DropdownMenuShortcut className="font-medium text-attention-text">
					{t("newCount", { count: entry.count })}
				</DropdownMenuShortcut>
			) : entry.hint ? (
				<DropdownMenuShortcut>{entry.hint}</DropdownMenuShortcut>
			) : null}
		</>
	);
}

function MenuEntry({ entry }: { entry: AccountEntry }) {
	if (entry.href)
		return (
			<DropdownMenuItem asChild>
				<Link
					href={entry.href}
					rel={entry.newTab ? "noopener noreferrer" : undefined}
					target={entry.newTab ? "_blank" : undefined}
				>
					<EntryInner entry={entry} />
				</Link>
			</DropdownMenuItem>
		);
	return (
		<DropdownMenuItem onSelect={entry.onSelect}>
			<EntryInner entry={entry} />
		</DropdownMenuItem>
	);
}

/** The person's face, name and handle: the account button and the sheet's first row. */
export type AccountUser = {
	name: string;
	username: string;
	imageUrl: string | null;
};

/** A person's face, name and handle, drawn from the data it is given. */
export function IdentityView({
	user,
	size,
}: {
	user: AccountUser;
	size?: FaceSize;
}) {
	return (
		<>
			<Face imageUrl={user.imageUrl} name={user.name || "?"} size={size} />
			<span className="flex min-w-0 flex-1 flex-col text-left">
				<span className="truncate font-semibold text-body text-fg">
					{user.name}
				</span>
				{user.username && (
					<span className="truncate font-normal text-fg-3 text-meta">
						@{user.username}
					</span>
				)}
			</span>
		</>
	);
}

export function AccountIdentity({ size }: { size?: FaceSize }) {
	return <IdentityView size={size} user={useAccountUser()} />;
}

/** The account button at the sidebar bottom (the menu's trigger). */
export function AccountTrigger({
	user,
	...props
}: { user: AccountUser } & React.ComponentProps<typeof Button>) {
	const t = useTranslations("shell.account");
	return (
		<Button
			className="h-auto w-full justify-start gap-2 p-2"
			kind="ghost"
			{...props}
		>
			<IdentityView user={user} />
			<span className="sr-only">{t("menu")}</span>
			<EllipsisVertical aria-hidden="true" className="text-fg-3" />
		</Button>
	);
}

/**
 * AccountMenu (account.html): the account button at the sidebar bottom and
 * its menu. Profile, Settings, the admin and invite entries, feedback, docs,
 * release notes, shortcuts, Sign out, then the version.
 */
export function AccountMenu() {
	const t = useTranslations("shell.account");
	const e = useAccountEntries();
	const user = useAccountUser();
	const groups = accountGroups([
		[e.profile],
		[e.settings],
		[e.admin, e.invites, e.inbox],
		[e.feedback, e.docs, e.releases, e.shortcuts],
		[e.signOut],
	]);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<AccountTrigger user={user} />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="w-(--radix-dropdown-menu-trigger-width)"
				side="top"
			>
				{groups.map((group, i) => (
					<Fragment key={group[0]?.id}>
						{i > 0 && <DropdownMenuSeparator />}
						{group.map((entry) => (
							<MenuEntry entry={entry} key={entry.id} />
						))}
					</Fragment>
				))}
				<DropdownMenuLabel className="px-3 pt-2 pb-1 font-normal text-fg-3 text-meta">
					{t("version", { version: APP_VERSION })}
				</DropdownMenuLabel>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
