"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import {
	currentNav,
	DESTINATIONS,
	hrefOf,
	type NavBadges,
	PHONE_TABS,
} from "~/lib/nav";
import { NavBadge } from "./nav-link";
import { useShellActions } from "./shell-context";

const TABS = PHONE_TABS.map((id) => DESTINATIONS.find((d) => d.id === id)).filter(
	(d) => d != null,
);

/**
 * BottomNav (phone web, IMPLEMENTATION §3): the five tabs of the iPhone
 * tab bar. Wealth, the tools and Settings are in the account sheet.
 */
export function BottomNav({
	badges,
	className,
}: {
	badges?: NavBadges;
	className?: string;
}) {
	const t = useTranslations("shell");
	const pathname = usePathname();
	const current = currentNav(pathname, TABS);
	return (
		<nav
			aria-label={t("bottomNav.label")}
			className={cn(
				"fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-line border-t bg-surface pb-[env(safe-area-inset-bottom)]",
				className,
			)}
		>
			{TABS.map((tab) => {
				const Icon = tab.icon;
				const href = hrefOf(tab) ?? tab.href;
				return (
					<Link
						aria-current={current === tab.id ? "page" : undefined}
						className="relative flex flex-1 flex-col items-center justify-center gap-0.5 font-medium text-fg-2 text-meta focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 aria-[current=page]:font-semibold aria-[current=page]:text-brand"
						href={href}
						key={tab.id}
					>
						<Icon aria-hidden="true" className="size-5.5" />
						<span>{t(`nav.${tab.id}`)}</span>
						<NavBadge
							className="absolute top-1 left-1/2 ml-1 min-w-4.5 leading-4.5"
							count={badges?.[tab.id]}
						/>
					</Link>
				);
			})}
		</nav>
	);
}

/** The floating Add above the bottom bar: a plain expense in the home currency. */
export function FloatingAdd({ className }: { className?: string }) {
	const t = useTranslations("shell.add");
	const { add } = useShellActions();
	return (
		<Button
			aria-label={t("expense")}
			className={cn(
				"fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 h-12 rounded-chip px-4 font-semibold shadow-menu",
				className,
			)}
			kind="primary"
			onClick={() => add("expense")}
		>
			<Plus aria-hidden="true" />
			{t("short")}
		</Button>
	);
}
