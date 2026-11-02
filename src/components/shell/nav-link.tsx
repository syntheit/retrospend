"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "~/lib/cn";
import { badgeText } from "~/lib/nav";

const ROW =
	"flex h-8.5 items-center gap-2 rounded-ctl px-3 font-medium text-body text-fg-2 transition-colors duration-(--t-state) ease-land can-hover:hover:bg-raised can-hover:hover:text-fg focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-brand";

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
				"rounded-chip bg-attention-bg text-attention-text text-meta min-w-5 px-1 text-center leading-5 font-semibold tabular-nums",
				className,
			)}
		>
			<span aria-hidden="true">{text}</span>
			<span className="sr-only">{t("needsYou", { count: count ?? 0 })}</span>
		</span>
	);
}

/**
 * One sidebar row: a lead (icon or cover) in one slot, the label, an optional
 * count. Extra props and the ref go to the link, so a context menu trigger
 * can wrap the row.
 */
export function SidebarLink({
	href,
	lead,
	label,
	current,
	badge,
	...rest
}: {
	href: string;
	lead: ReactNode;
	label: string;
	current: boolean;
	badge?: number;
} & Omit<ComponentProps<typeof Link>, "href" | "children" | "className">) {
	return (
		<Link
			{...rest}
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

const RAIL =
	"relative flex w-full flex-col items-center gap-1 rounded-ctl px-1 py-2 font-medium text-meta text-fg-2 transition-colors duration-(--t-state) ease-land can-hover:hover:bg-raised can-hover:hover:text-fg focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-brand";

/**
 * One rail row (the sidebar collapsed, T2): the icon over its label, and the
 * selected one is a single lozenge around both. Never icon-only: the label
 * always shows.
 */
export function RailLink({
	href,
	lead,
	label,
	current,
	badge,
	...rest
}: {
	href: string;
	lead: ReactNode;
	label: string;
	current: boolean;
	badge?: number;
} & Omit<ComponentProps<typeof Link>, "href" | "children" | "className">) {
	return (
		<Link
			{...rest}
			aria-current={current ? "page" : undefined}
			className={RAIL}
			href={href}
		>
			<span className="relative flex size-4 shrink-0 items-center justify-center">
				{lead}
				<NavBadge className="absolute -top-2 left-3" count={badge} />
			</span>
			<span className="w-full min-w-0 truncate text-center">{label}</span>
		</Link>
	);
}
