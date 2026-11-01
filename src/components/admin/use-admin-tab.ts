"use client";

import { useCallback, useEffect, useState } from "react";

export const ADMIN_TABS = [
	"users",
	"participants",
	"invite-codes",
	"feedback",
	"ai-usage",
	"server",
	"settings",
	"audit-logs",
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

/** The tab a URL hash names ("#feedback"), or null. */
export function tabFromHash(hash: string): AdminTab | null {
	const id = hash.replace(/^#/, "");
	return (ADMIN_TABS as readonly string[]).includes(id) ? (id as AdminTab) : null;
}

/**
 * The admin section. /admin#feedback (or #users, #invite-codes, #server, ...)
 * opens that tab, and changing tab writes its name to the hash, so a link
 * or a reload lands on the same one.
 */
export function useAdminTab() {
	const [tab, setTab] = useState<AdminTab>("users");
	useEffect(() => {
		const fromHash = () => {
			const next = tabFromHash(window.location.hash);
			if (next) setTab(next);
		};
		fromHash();
		window.addEventListener("hashchange", fromHash);
		return () => window.removeEventListener("hashchange", fromHash);
	}, []);
	const onTabChange = useCallback((value: string) => {
		const next = tabFromHash(value);
		if (!next) return;
		setTab(next);
		history.replaceState(null, "", `#${next}`);
	}, []);
	return { tab, onTabChange };
}
