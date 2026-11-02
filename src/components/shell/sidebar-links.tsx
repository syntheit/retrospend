"use client";

import { useTranslations } from "next-intl";
import type { NavBadges, NavEntry } from "~/lib/nav";
import { SidebarLink } from "./nav-link";

export function GroupLabel({ children }: { children: string }) {
	return (
		<h2 className="text-fg-3 text-meta px-3 pt-4 pb-1 font-medium tracking-wider uppercase">
			{children}
		</h2>
	);
}

export function EntryLinks({
	entries,
	current,
	badges,
	label,
}: {
	entries: readonly NavEntry[];
	current: string | null;
	badges?: NavBadges;
	label: string;
}) {
	const t = useTranslations("shell.nav");
	return (
		<nav aria-label={label} className="flex flex-col gap-0.5">
			{entries.map((entry) => {
				const Icon = entry.icon;
				return (
					<SidebarLink
						badge={badges?.[entry.id as keyof NavBadges]}
						current={current === entry.id}
						href={entry.href}
						key={entry.id}
						label={t(entry.id)}
						lead={<Icon aria-hidden="true" className="size-4" />}
					/>
				);
			})}
		</nav>
	);
}
