"use client";

import {
	IconBook,
	IconDotsVertical,
	IconLogout,
	IconMessageReport,
	IconSparkles,
	IconSettings,
	IconSpeakerphone,
	IconTerminal2,
	IconTicket,
	IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FeedbackModal } from "~/components/feedback-modal";
import { UserAvatar } from "~/components/ui/user-avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "~/components/ui/sidebar";
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";

// Extend the session user type to include additional fields
type ExtendedUser = NonNullable<
	NonNullable<ReturnType<typeof useSession>["data"]>["user"]
> & {
	role: string;
	username: string;
	isActive: boolean;
};

export function NavUser({
	user,
}: {
	user: {
		name: string;
		username: string;
		avatar: string;
	};
}) {
	const { isMobile } = useSidebar();
	const { data: session } = useSession();
	const router = useRouter();
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const { data: avatarData } = api.profile.getMyAvatar.useQuery();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const { data: flags } = api.system.getFeatureFlags.useQuery();
	const avatarUrl = avatarData?.avatarUrl ?? user.avatar ?? null;
	const extendedUser = session?.user as ExtendedUser;
	const isAdmin = extendedUser?.role === "ADMIN";
	const feedbackEnabled = flags?.feedbackEnabled ?? false;

	const [dropdownOpen, setDropdownOpen] = useState(false);

	const { data: feedbackCountData } =
		api.feedback.unreadCount.useQuery(undefined, {
			enabled: isAdmin && feedbackEnabled,
			refetchInterval: 60_000,
		});
	const unreadFeedback = feedbackCountData?.count ?? 0;

	const handleLogout = async () => {
		try {
			await authClient.signOut();
			router.push("/login");
		} catch (error) {
			handleError(error, "Failed to log out");
		}
	};

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							aria-label="User menu"
							className="cursor-pointer focus-visible:ring-0 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							size="lg"
							onContextMenu={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setDropdownOpen((prev) => !prev);
							}}
						>
							<UserAvatar
								avatarUrl={avatarUrl}
								className="rounded-lg"
								name={user.name}
								size="sm"
							/>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user.name}</span>
								<span className="truncate text-muted-foreground text-xs">
									@{user.username}
								</span>
							</div>
							<IconDotsVertical className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<UserAvatar
									avatarUrl={avatarUrl}
									className="rounded-lg"
									name={user.name}
									size="sm"
								/>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-muted-foreground text-xs">
										@{user.username}
									</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem asChild>
								<Link
									className="cursor-pointer"
									href={`/u/${user.username}`}
									rel="noopener noreferrer"
									target="_blank"
								>
									<IconUser />
									Your profile
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem asChild>
								<Link className="cursor-pointer" href="/settings">
									<IconSettings />
									Settings
								</Link>
							</DropdownMenuItem>
							{settings?.allowAllUsersToGenerateInvites && (
								<DropdownMenuItem asChild>
									<Link className="cursor-pointer" href="/invite-codes">
										<IconTicket />
										Invite Codes
									</Link>
								</DropdownMenuItem>
							)}
							{isAdmin && (
								<DropdownMenuItem asChild>
									<Link className="cursor-pointer" href="/admin">
										<IconTerminal2 />
										Admin Panel
									</Link>
								</DropdownMenuItem>
							)}
							{isAdmin && feedbackEnabled && (
								<DropdownMenuItem asChild>
									<Link className="cursor-pointer" href="/feedback">
										<IconMessageReport />
										View Feedback
										{unreadFeedback > 0 && (
											<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 font-semibold tabular-nums text-[10px] text-white leading-none">
												{unreadFeedback > 99 ? "99+" : unreadFeedback}
											</span>
										)}
									</Link>
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						{feedbackEnabled && (
							<DropdownMenuItem
								className="cursor-pointer"
								onClick={() => setFeedbackOpen(true)}
							>
								<IconSpeakerphone />
								Feedback
							</DropdownMenuItem>
						)}
						<DropdownMenuItem asChild>
							<Link className="cursor-pointer" href="/releases?from=app" target="_blank">
								<IconSparkles />
								Release Notes
							</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link className="cursor-pointer" href="/docs?from=app" target="_blank">
								<IconBook />
								Documentation
							</Link>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="cursor-pointer" variant="destructive" onClick={handleLogout}>
							<IconLogout />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
			{feedbackEnabled && (
				<FeedbackModal onOpenChange={setFeedbackOpen} open={feedbackOpen} />
			)}
		</SidebarMenu>
	);
}
