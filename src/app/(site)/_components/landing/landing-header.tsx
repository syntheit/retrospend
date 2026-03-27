"use client";

import {
	BookOpen,
	LogOut,
	Menu,
	MessageSquareWarning,
	Settings,
	Megaphone,
	Terminal,
	Ticket,
	User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FeedbackModal } from "~/components/feedback-modal";
import { Button } from "~/components/ui/button";
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
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";

const NAV_LINKS = [
	{ label: "Overview", href: "#overview" },
	{ label: "Budgets", href: "#budgets" },
	{ label: "Splitting", href: "#splitting" },
	{ label: "Wealth", href: "#wealth" },
];

type ExtendedUser = {
	role: string;
	username: string;
	name: string;
	image?: string | null;
};

export function LandingHeader({
	scrollContainerRef,
}: {
	scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
	const { data: session, isPending } = useSession();
	const router = useRouter();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const { data: flags } = api.system.getFeatureFlags.useQuery();
	const feedbackEnabled = flags?.feedbackEnabled ?? false;

	const user = session?.user as ExtendedUser | undefined;
	const isLoggedIn = !isPending && !!user;
	const isAdmin = isLoggedIn && user?.role === "ADMIN";

	const { data: avatarData } = api.profile.getMyAvatar.useQuery(undefined, {
		enabled: isLoggedIn,
	});
	const { data: settings } = api.settings.getGeneral.useQuery(undefined, {
		enabled: isLoggedIn,
	});
	const { data: feedbackCountData } = api.feedback.unreadCount.useQuery(
		undefined,
		{ enabled: isAdmin && feedbackEnabled },
	);

	const unreadFeedback = feedbackCountData?.count ?? 0;

	const handleAnchorClick = (
		e: React.MouseEvent<HTMLAnchorElement>,
		href: string,
	) => {
		e.preventDefault();
		const id = href.replace("#", "");
		const container = scrollContainerRef.current;
		const target = document.getElementById(id);
		if (container && target) {
			const top = target.offsetTop - 80;
			container.scrollTo({ top, behavior: "smooth" });
		}
		setMobileOpen(false);
	};

	const handleLogout = async () => {
		try {
			await authClient.signOut();
			router.push("/login");
		} catch (error) {
			handleError(error, "Failed to log out");
		}
	};

	return (
		<header className="sticky top-0 z-50 border-border border-b bg-background/80 backdrop-blur-lg">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
				<span className="font-bold text-lg tracking-tight">Retrospend</span>

				<nav aria-label="Main navigation" className="hidden items-center gap-6 md:flex">
					{NAV_LINKS.map((link) => (
						<a
							className="text-muted-foreground text-sm transition-colors hover:text-foreground"
							href={link.href}
							key={link.href}
							onClick={(e) => handleAnchorClick(e, link.href)}
						>
							{link.label}
						</a>
					))}
					<Link
						className="text-muted-foreground text-sm transition-colors hover:text-foreground"
						href="/docs"
					>
						Docs
					</Link>
				</nav>

				<div className="flex items-center gap-2">
					{isPending ? (
						<div className="h-8 w-8" />
					) : isLoggedIn && user ? (
						<>
							<Button asChild className="hidden select-none sm:inline-flex" size="sm">
								<Link href="/dashboard">Go to Dashboard</Link>
							</Button>
							<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
								<DropdownMenuTrigger asChild>
									<Button
										aria-label="User menu"
										className="h-auto w-auto rounded-full p-0"
										type="button"
										variant="ghost"
										onContextMenu={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setDropdownOpen((prev) => !prev);
										}}
									>
										<UserAvatar
											name={user.name}
											avatarUrl={avatarData?.avatarUrl ?? null}
											size="sm"
										/>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-56 rounded-lg">
									<DropdownMenuLabel className="p-0 font-normal">
										<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
											<UserAvatar
												name={user.name}
												avatarUrl={avatarData?.avatarUrl ?? null}
												className="rounded-lg"
												size="sm"
											/>
											<div className="grid flex-1 text-left text-sm leading-tight">
												<span className="truncate font-medium">
													{user.name}
												</span>
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
												<User />
												Your profile
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link className="cursor-pointer" href="/settings">
												<Settings />
												Settings
											</Link>
										</DropdownMenuItem>
										{settings?.allowAllUsersToGenerateInvites && (
											<DropdownMenuItem asChild>
												<Link className="cursor-pointer" href="/invite-codes">
													<Ticket />
													Invite Codes
												</Link>
											</DropdownMenuItem>
										)}
										{isAdmin && (
											<DropdownMenuItem asChild>
												<Link className="cursor-pointer" href="/admin">
													<Terminal />
													Admin Panel
												</Link>
											</DropdownMenuItem>
										)}
										{isAdmin && feedbackEnabled && (
											<DropdownMenuItem asChild>
												<Link className="cursor-pointer" href="/feedback">
													<MessageSquareWarning />
													View Feedback
													{unreadFeedback > 0 && (
														<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 font-semibold text-[10px] text-white leading-none">
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
											<Megaphone />
											Feedback
										</DropdownMenuItem>
									)}
									<DropdownMenuItem asChild>
										<Link className="cursor-pointer" href="/docs" target="_blank">
											<BookOpen />
											Documentation
										</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="cursor-pointer"
										variant="destructive"
										onClick={handleLogout}
									>
										<LogOut />
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
							{feedbackEnabled && (
								<FeedbackModal onOpenChange={setFeedbackOpen} open={feedbackOpen} />
							)}
						</>
					) : (
						<>
							<Button
								asChild
								className="hidden sm:inline-flex"
								size="sm"
								variant="ghost"
							>
								<Link href="/login">Login</Link>
							</Button>
							<Button asChild className="hidden sm:inline-flex" size="sm">
								<Link href="/signup">Get Started</Link>
							</Button>
						</>
					)}

					{/* Mobile hamburger */}
					<Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
						<SheetTrigger asChild>
							<Button className="md:hidden" size="icon" variant="ghost">
								<Menu className="h-5 w-5" />
								<span className="sr-only">Open menu</span>
							</Button>
						</SheetTrigger>
						<SheetContent className="w-3/4 max-w-64" side="right">
							<SheetTitle className="sr-only">Navigation</SheetTitle>
							<SheetDescription className="sr-only">
								Main navigation links
							</SheetDescription>
							<nav aria-label="Main navigation" className="flex flex-col gap-4 p-4">
								{NAV_LINKS.map((link) => (
									<a
										className="font-medium text-base text-foreground"
										href={link.href}
										key={link.href}
										onClick={(e) => handleAnchorClick(e, link.href)}
									>
										{link.label}
									</a>
								))}
								<Link
									className="font-medium text-base text-foreground"
									href="/docs"
									onClick={() => setMobileOpen(false)}
								>
									Docs
								</Link>
							</nav>
							<div className="flex flex-col gap-2 border-t px-4 pt-4">
								{isLoggedIn ? (
									<Button
										asChild
										onClick={() => setMobileOpen(false)}
										size="sm"
									>
										<Link href="/dashboard">Go to Dashboard</Link>
									</Button>
								) : (
									<>
										<Button
											asChild
											onClick={() => setMobileOpen(false)}
											size="sm"
											variant="ghost"
										>
											<Link href="/login">Login</Link>
										</Button>
										<Button
											asChild
											onClick={() => setMobileOpen(false)}
											size="sm"
										>
											<Link href="/signup">Get Started</Link>
										</Button>
									</>
								)}
							</div>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		</header>
	);
}
