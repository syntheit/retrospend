"use client";

import {
	BookOpen,
	FileText,
	Inbox,
	KeyRound,
	Keyboard,
	LogOut,
	type LucideIcon,
	MessageSquare,
	Settings,
	Shield,
	UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";
import { settingsHref } from "~/lib/nav";
import { api } from "~/trpc/react";
import { useShellActions } from "./shell-context";

/** One account entry, drawn as a menu item on desktop and a row in the phone sheet. */
export type AccountEntry = {
	id: string;
	icon: LucideIcon;
	label: string;
	href?: string;
	/** Docs and release notes open outside the app, as today. */
	newTab?: boolean;
	onSelect?: () => void;
	/** A count that needs a look ("3 new"), drawn as attention text. */
	count?: number;
	/** Desktop-only keyboard hint. */
	hint?: string;
};

type SessionUser = {
	name?: string | null;
	image?: string | null;
	username?: string | null;
	role?: string | null;
};

/** Who is signed in, for the account button and sheet. */
export function useAccountUser() {
	const { data: session } = useSession();
	const { data: avatar } = api.profile.getMyAvatar.useQuery();
	const user = session?.user as SessionUser | undefined;
	return {
		name: user?.name ?? "",
		username: user?.username ?? "",
		imageUrl: avatar?.avatarUrl ?? user?.image ?? null,
		isAdmin: user?.role === "ADMIN",
	};
}

/**
 * The account menu's entries (account.html), each shown only to the people
 * it applies to: Admin and the feedback inbox to admins, Invite codes when
 * the app lets members invite, feedback when it is turned on.
 */
export function useAccountEntries() {
	const t = useTranslations("shell.account");
	const router = useRouter();
	const { openShortcuts, openFeedback } = useShellActions();
	const { isAdmin } = useAccountUser();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const { data: flags } = api.system.getFeatureFlags.useQuery();
	const feedbackOn = flags?.feedbackEnabled ?? false;
	const { data: inbox } = api.feedback.unreadCount.useQuery(undefined, {
		enabled: isAdmin && feedbackOn,
		refetchInterval: 60_000,
	});

	const signOut = async () => {
		try {
			await authClient.signOut();
			router.push("/login");
		} catch (error) {
			handleError(error, t("signOutFailed"));
		}
	};

	const entry = (e: AccountEntry, show = true) => (show ? e : null);
	return {
		profile: entry({
			id: "profile",
			icon: UserRound,
			label: t("profile"),
			href: settingsHref("profile"),
		}),
		settings: entry({
			id: "settings",
			icon: Settings,
			label: t("settings"),
			href: "/settings",
		}),
		admin: entry(
			{ id: "admin", icon: Shield, label: t("admin"), href: "/admin" },
			isAdmin,
		),
		invites: entry(
			{
				id: "invites",
				icon: KeyRound,
				label: t("inviteCodes"),
				href: "/invite-codes",
			},
			settings?.allowAllUsersToGenerateInvites ?? false,
		),
		inbox: entry(
			{
				id: "inbox",
				icon: Inbox,
				label: t("feedbackInbox"),
				href: "/feedback",
				count: inbox?.count ?? 0,
			},
			isAdmin && feedbackOn,
		),
		feedback: entry(
			{
				id: "feedback",
				icon: MessageSquare,
				label: t("sendFeedback"),
				onSelect: openFeedback,
			},
			feedbackOn,
		),
		docs: entry({
			id: "docs",
			icon: BookOpen,
			label: t("docs"),
			href: "/docs?from=app",
			newTab: true,
		}),
		releases: entry({
			id: "releases",
			icon: FileText,
			label: t("releaseNotes"),
			href: "/releases?from=app",
			newTab: true,
		}),
		shortcuts: entry({
			id: "shortcuts",
			icon: Keyboard,
			label: t("shortcuts"),
			onSelect: openShortcuts,
			hint: "?",
		}),
		signOut: entry({
			id: "signOut",
			icon: LogOut,
			label: t("signOut"),
			onSelect: () => void signOut(),
		}),
	};
}

export type AccountEntries = ReturnType<typeof useAccountEntries>;

/** Groups of entries in order; empty groups drop out so no separator doubles up. */
export function accountGroups(
	groups: (AccountEntry | null)[][],
): AccountEntry[][] {
	return groups
		.map((g) => g.filter((e): e is AccountEntry => e != null))
		.filter((g) => g.length > 0);
}
