"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface UseNavigationGuardOptions {
	enabled: boolean;
	onDiscard?: () => void;
}

export function useNavigationGuard({
	enabled,
	onDiscard,
}: UseNavigationGuardOptions) {
	const router = useRouter();
	const [showDialog, setShowDialog] = useState(false);
	const [pendingNavigation, setPendingNavigation] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (!enabled) return;

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (enabled) {
				e.preventDefault();
				e.returnValue = "";
			}
		};

		const handleAnchorClick = (event: MouseEvent) => {
			if (!enabled) return;
			const target = event.target as HTMLElement | null;
			const anchor = target?.closest<HTMLAnchorElement>("a[href]");
			if (!anchor || anchor.target === "_blank") return;

			const href = anchor.getAttribute("href");
			if (
				!href ||
				href.startsWith("#") ||
				href.startsWith("mailto:") ||
				href.startsWith("tel:")
			)
				return;

			// Handle potentially absolute URLs to the same origin
			try {
				const url = new URL(href, window.location.origin);
				if (url.origin !== window.location.origin) return;
				if (
					url.pathname === window.location.pathname &&
					url.search === window.location.search
				)
					return;

				event.preventDefault();
				setPendingNavigation(url.pathname + url.search + url.hash);
				setShowDialog(true);
			} catch {
				// Ignore invalid URLs
			}
		};

		const handlePopState = (event: PopStateEvent) => {
			if (!enabled) return;
			event.preventDefault();
			// Push state back to prevent back navigation
			history.pushState(null, "", window.location.href);
			setPendingNavigation("back");
			setShowDialog(true);
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		window.addEventListener("click", handleAnchorClick, true); // Use capture to catch clicks before other handlers
		window.addEventListener("popstate", handlePopState);

		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			window.removeEventListener("click", handleAnchorClick, true);
			window.removeEventListener("popstate", handlePopState);
		};
	}, [enabled]);

	const handleDiscard = useCallback(() => {
		setShowDialog(false);
		onDiscard?.();

		if (pendingNavigation) {
			const nav = pendingNavigation;
			setPendingNavigation(null);

			if (nav === "back") {
				router.back();
			} else if (nav === "close") {
				// Special case for modals, handled by the caller
			} else if (nav.startsWith("mode:")) {
				// Internal mode switch handled by caller
			} else {
				router.push(nav);
			}
		}
	}, [pendingNavigation, router, onDiscard]);

	const handleStay = useCallback(() => {
		setShowDialog(false);
		setPendingNavigation(null);
	}, []);

	return {
		showDialog,
		setShowDialog,
		handleDiscard,
		handleStay,
		pendingNavigation,
		setPendingNavigation,
	};
}
