"use client";

import { type RefObject, useEffect, useState } from "react";

const ADMIN_TABS = [
	"users",
	"participants",
	"invite-codes",
	"ai-usage",
	"audit-logs",
];

/**
 * The admin data tab. /admin#users (or #participants, #invite-codes, ...)
 * opens that tab, and changing tab scrolls its tab row into view.
 */
export function useAdminTab(anchor: RefObject<HTMLElement | null>) {
	const [tab, setTab] = useState("users");
	const scroll = () =>
		requestAnimationFrame(() =>
			anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
		);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once on arrival
	useEffect(() => {
		const hash = window.location.hash.slice(1);
		if (!ADMIN_TABS.includes(hash)) return;
		setTab(hash);
		scroll();
	}, []);
	return {
		tab,
		onTabChange: (value: string) => {
			setTab(value);
			scroll();
		},
	};
}
