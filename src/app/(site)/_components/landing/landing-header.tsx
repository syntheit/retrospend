"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tip } from "~/components/ui/tooltip";
import { useSession } from "~/hooks/use-session";

const NAV_LINKS = [
	{ labelKey: "navOverview" as const, href: "#overview" },
	{ labelKey: "navBudgets" as const, href: "#budgets" },
	{ labelKey: "navSplitting" as const, href: "#splitting" },
	{ labelKey: "navWealth" as const, href: "#wealth" },
];

const LINK_CLASS =
	"rounded-ctl text-fg-2 text-small focus-visible:outline-brand can-hover:hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The public header. Signed in, one button opens the app: the account menu,
 * Settings, Admin and Feedback live in the app's own shell.
 */
export function LandingHeader({
	scrollContainerRef,
}: {
	scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
	const { data: session, isPending } = useSession();
	const t = useTranslations("landing");
	const isLoggedIn = !isPending && !!session?.user;

	const scrollTo = (href: string) => {
		const container = scrollContainerRef.current;
		const target = document.getElementById(href.replace("#", ""));
		if (container && target) {
			container.scrollTo({ top: target.offsetTop - 80, behavior: "smooth" });
		}
	};

	const handleAnchorClick = (
		e: React.MouseEvent<HTMLAnchorElement>,
		href: string,
	) => {
		e.preventDefault();
		scrollTo(href);
	};

	return (
		<header className="border-line bg-bg sticky top-0 z-50 border-b">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
				<span className="text-fg text-section">Retrospend</span>

				<nav
					aria-label={t("navMain")}
					className="hidden items-center gap-6 md:flex"
				>
					{NAV_LINKS.map((link) => (
						<a
							className={LINK_CLASS}
							href={link.href}
							key={link.href}
							onClick={(e) => handleAnchorClick(e, link.href)}
						>
							{t(link.labelKey)}
						</a>
					))}
					<Link className={LINK_CLASS} href="/docs">
						{t("navDocs")}
					</Link>
				</nav>

				<div className="flex items-center gap-2">
					{isPending ? null : isLoggedIn ? (
						<Button asChild className="select-none" kind="primary">
							<Link href="/home">{t("goToDashboard")}</Link>
						</Button>
					) : (
						<>
							<Button asChild className="hidden sm:inline-flex" kind="ghost">
								<Link href="/login">{t("login")}</Link>
							</Button>
							<Button asChild className="hidden sm:inline-flex" kind="primary">
								<Link href="/signup">{t("getStarted")}</Link>
							</Button>
						</>
					)}

					<DropdownMenu>
						<Tip content={t("openMenu")}>
							<DropdownMenuTrigger asChild>
								<Button
									aria-label={t("openMenu")}
									className="md:hidden"
									icon
									kind="ghost"
								>
									<Menu />
								</Button>
							</DropdownMenuTrigger>
						</Tip>
						<DropdownMenuContent align="end" className="min-w-48">
							{NAV_LINKS.map((link) => (
								<DropdownMenuItem
									key={link.href}
									onSelect={() => scrollTo(link.href)}
								>
									{t(link.labelKey)}
								</DropdownMenuItem>
							))}
							<DropdownMenuItem asChild>
								<Link href="/docs">{t("navDocs")}</Link>
							</DropdownMenuItem>
							{!isPending && !isLoggedIn && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<Link href="/login">{t("login")}</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link href="/signup">{t("getStarted")}</Link>
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</header>
	);
}
