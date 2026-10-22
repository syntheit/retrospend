"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";
import { badgeText } from "~/lib/nav";

const ROW =
	"flex h-ctl items-center gap-2 rounded-ctl px-3 font-medium text-body text-fg-2 transition-colors duration-(--t-state) ease-land can-hover:hover:bg-raised can-hover:hover:text-fg focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-brand";

/** A Needs you count on a nav item: a number in an attention pill, with words for screen readers. */
export function NavBadge({
	count,
	className,
}: {
	count: number | undefined;
	className?: string;
}) {
	const t = useTranslations("shell.nav");
	const text = badgeText(count);
	if (!text) return null;
	return (
		<span
			className={cn(
				"min-w-5 rounded-chip bg-attention-bg px-1 text-center font-semibold text-attention-text text-meta tabular-nums leading-5",
				className,
			)}
		>
			<span aria-hidden="true">{text}</span>
			<span className="sr-only">{t("needsYou", { count: count ?? 0 })}</span>
		</span>
	);
}

/** One sidebar row: a lead (icon or cover) in one slot, the label, an optional count. */
export function SidebarLink({
	href,
	lead,
	label,
	current,
	badge,
}: {
	href: string;
	lead: ReactNode;
	label: string;
	current: boolean;
	badge?: number;
}) {
	return (
		<Link
			aria-current={current ? "page" : undefined}
			className={ROW}
			href={href}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				{lead}
			</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<NavBadge count={badge} />
		</Link>
	);
}
