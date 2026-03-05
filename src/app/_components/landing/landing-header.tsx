"use client";

import {
	IconLogout,
	IconMenu2,
	IconSettings,
	IconUserCircle,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
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
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";

const NAV_LINKS = [
	{ label: "Overview", href: "#overview" },
	{ label: "Budgets", href: "#budgets" },
	{ label: "Wealth", href: "#wealth" },
];

function getUserInitials(name: string): string {
	if (!name || name.trim() === "") return "U";
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "U";
	if (parts.length === 1) return (parts[0]?.charAt(0) ?? "U").toUpperCase();
	return (
		(parts[0]?.charAt(0) ?? "") + (parts[parts.length - 1]?.charAt(0) ?? "")
	).toUpperCase();
}

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

	const user = session?.user as ExtendedUser | undefined;
	const isLoggedIn = !isPending && !!user;
	const isAdmin = isLoggedIn && user?.role === "ADMIN";

	return (
		<header className="sticky top-0 z-50 border-border border-b bg-background/80 backdrop-blur-lg">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
				<span className="font-bold text-lg tracking-tight">Retrospend</span>

				<nav className="hidden items-center gap-6 md:flex">
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
				</nav>

				<div className="flex items-center gap-2">
					{isPending ? (
						<div className="h-8 w-8" />
					) : isLoggedIn && user ? (
						<>
							<Button asChild className="hidden sm:inline-flex" size="sm">
								<Link href="/app">Go to Dashboard</Link>
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										className="cursor-pointer rounded-full outline-none ring-ring focus-visible:ring-2"
										type="button"
									>
										<Avatar className="h-8 w-8 grayscale">
											<AvatarImage
												alt={user.name}
												src={user.image ?? undefined}
											/>
											<AvatarFallback className="text-xs">
												{getUserInitials(user.name)}
											</AvatarFallback>
										</Avatar>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuLabel className="p-0 font-normal">
										<div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
											<Avatar className="h-8 w-8">
												<AvatarImage
													alt={user.name}
													src={user.image ?? undefined}
												/>
												<AvatarFallback>
													{getUserInitials(user.name)}
												</AvatarFallback>
											</Avatar>
											<div className="grid flex-1 text-left leading-tight">
												<span className="truncate font-medium text-xs">
													{user.name}
												</span>
												<span className="truncate text-[11px] text-muted-foreground">
													@{user.username}
												</span>
											</div>
										</div>
									</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuGroup>
										<DropdownMenuItem asChild>
											<a className="cursor-pointer" href="/app/account">
												<IconUserCircle className="mr-2 h-4 w-4" />
												Account
											</a>
										</DropdownMenuItem>
										{isAdmin && (
											<DropdownMenuItem asChild>
												<Link className="cursor-pointer" href="/app/admin">
													<IconSettings className="mr-2 h-4 w-4" />
													Admin Panel
												</Link>
											</DropdownMenuItem>
										)}
									</DropdownMenuGroup>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="cursor-pointer"
										onClick={handleLogout}
									>
										<IconLogout className="mr-2 h-4 w-4" />
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
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
								<IconMenu2 className="h-5 w-5" />
								<span className="sr-only">Open menu</span>
							</Button>
						</SheetTrigger>
						<SheetContent className="w-64" side="right">
							<SheetTitle className="sr-only">Navigation</SheetTitle>
							<SheetDescription className="sr-only">
								Main navigation links
							</SheetDescription>
							<nav className="flex flex-col gap-4 p-4">
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
							</nav>
							<div className="flex flex-col gap-2 border-t px-4 pt-4">
								{isLoggedIn ? (
									<Button
										asChild
										onClick={() => setMobileOpen(false)}
										size="sm"
									>
										<Link href="/app">Go to Dashboard</Link>
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
