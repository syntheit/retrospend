"use client";

import { useTranslations } from "next-intl";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { FeedbackModal } from "~/components/feedback-modal";
import { PageTransition } from "~/components/page-transition";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { useEntrySheets } from "~/features/entry/context";
import { ExpensePaneHost } from "~/features/entry/detail/expense-pane";
import { usePaneRoute } from "~/features/entry/detail/pane-route";
import { ADD_ACTIONS, type AddId, type NavBadges } from "~/lib/nav";
import { AccountSheet } from "./account-sheet";
import { BottomNav, FloatingAdd } from "./bottom-nav";
import { NotificationsPanel } from "./notifications";
import { ShellPalette } from "./palette";
import { type ShellActions, ShellActionsContext } from "./shell-context";
import { shellShortcut } from "./shortcuts";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { ShellSidebar } from "./sidebar";

type Layer = "palette" | "shortcuts" | "account" | "notifications" | "feedback";

type SetLayer = React.Dispatch<React.SetStateAction<Layer | null>>;

function useShellKeys(actions: ShellActions, setLayer: SetLayer) {
	useEffect(() => {
		// On window, so it runs after document listeners: a page search that
		// takes focus on its own key leaves the next letters to itself.
		const onKey = (e: KeyboardEvent) => {
			const hit = shellShortcut(e, document.activeElement);
			if (!hit) return;
			e.preventDefault();
			if (hit.kind === "palette")
				setLayer((l) => (l === "palette" ? null : "palette"));
			else if (hit.kind === "shortcuts") setLayer("shortcuts");
			else actions.add(hit.id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [actions, setLayer]);
}

const DESKTOP = "(min-width: 768px)";
const onDesktopChange = (notify: () => void) => {
	const mql = window.matchMedia(DESKTOP);
	mql.addEventListener("change", notify);
	return () => mql.removeEventListener("change", notify);
};

/**
 * Whether the sidebar is mounted. The server draws it (hidden below md by
 * CSS) so desktop does not jump; a phone drops it on hydration, so its
 * queries never run there.
 */
function useDesktop(): boolean {
	return useSyncExternalStore(
		onDesktopChange,
		() => window.matchMedia(DESKTOP).matches,
		() => true,
	);
}

const query = (q: string) => (notify: () => void) => {
	const mql = window.matchMedia(q);
	mql.addEventListener("change", notify);
	return () => mql.removeEventListener("change", notify);
};
const WIDE = "(min-width: 1024px)";
const WIDER = "(min-width: 1280px)";
const RAIL_KEY = "sidebar-rail";

function useWide(q: string): boolean {
	return useSyncExternalStore(
		query(q),
		() => window.matchMedia(q).matches,
		() => true,
	);
}

/**
 * Sidebar or rail (T2). By default the sidebar is a rail below 1024, and
 * while the detail pane is open below 1280 (so the list keeps its room).
 * The toggle is the person's choice and is remembered on this device.
 */
function useRail(paneOpen: boolean) {
	const wide = useWide(WIDE);
	const wider = useWide(WIDER);
	const [pref, setPref] = useState<boolean | null>(null);
	useEffect(() => {
		try {
			const v = window.localStorage.getItem(RAIL_KEY);
			if (v === "1" || v === "0") setPref(v === "1");
		} catch {
			// no storage: the width decides
		}
	}, []);
	const auto = !wide || (paneOpen && !wider);
	const rail = pref ?? auto;
	const toggle = useCallback(() => {
		setPref(!rail);
		try {
			window.localStorage.setItem(RAIL_KEY, rail ? "0" : "1");
		} catch {
			// not remembered
		}
	}, [rail]);
	return { rail, toggle };
}

/** Phone toasts sit above the bottom bar and the floating Add. */
function useToastOffset() {
	useEffect(() => {
		const root = document.documentElement.style;
		root.setProperty(
			"--toast-mobile-bottom",
			"calc(8.5rem + env(safe-area-inset-bottom))",
		);
		return () => {
			root.removeProperty("--toast-mobile-bottom");
		};
	}, []);
}

/**
 * The app shell: sidebar on desktop and tablet, bottom bar
 * and floating Add on phones, the palette, the account and notifications
 * sheets and the N / I / T keys. Pages render inside it unchanged.
 */
export function AppShell({
	children,
	badges,
}: {
	children: React.ReactNode;
	/** Needs you counts (2E); the bars show none until they come. */
	badges?: NavBadges;
}) {
	const t = useTranslations("shell");
	const sheets = useEntrySheets();
	const toast = useToast();
	const [layer, setLayer] = useState<Layer | null>(null);
	const layerProps = (l: Layer) => ({
		open: layer === l,
		onOpenChange: (open: boolean) => setLayer(open ? l : null),
	});

	const actions = useMemo<ShellActions>(
		() => ({
			add: (id: AddId) => {
				const entry = ADD_ACTIONS.find((a) => a.id === id);
				if (!entry?.ready) {
					toast.info(t("add.notYet", { what: t(`add.${id}`) }));
					return;
				}
				setLayer(null);
				if (id === "expense") sheets.open({ kind: "expense", mode: "create" });
				else sheets.open({ kind: id });
			},
			openPalette: () => setLayer("palette"),
			openShortcuts: () => setLayer("shortcuts"),
			openAccountSheet: () => setLayer("account"),
			openNotificationsSheet: () => setLayer("notifications"),
			openFeedback: () => setLayer("feedback"),
		}),
		[sheets, t, toast],
	);
	useShellKeys(actions, setLayer);
	useToastOffset();
	const desktop = useDesktop();
	const paneOpen = usePaneRoute().target !== null;
	const { rail, toggle } = useRail(paneOpen);

	return (
		<ShellActionsContext value={actions}>
			<div className="bg-bg text-fg flex h-svh w-full overflow-hidden">
				<a
					className="rounded-ctl bg-surface text-body focus-visible:outline-brand focus:shadow-menu sr-only px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus-visible:outline-2"
					href="#main-content"
				>
					{t("skipToContent")}
				</a>
				{desktop && (
					<ShellSidebar
						badges={badges}
						className="hidden md:flex"
						onToggleRail={toggle}
						rail={rail}
					/>
				)}
				<main
					className="bg-bg flex min-w-0 flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0"
					id="main-content"
				>
					<PageTransition>{children}</PageTransition>
				</main>
				<ExpensePaneHost />
				<BottomNav badges={badges} className="md:hidden" />
				<FloatingAdd className="md:hidden" />
			</div>
			<ShellPalette {...layerProps("palette")} />
			<ShortcutsSheet {...layerProps("shortcuts")} />
			<AccountSheet {...layerProps("account")} />
			<Sheet
				detent="large"
				footer={false}
				title={t("notifications.title")}
				{...layerProps("notifications")}
			>
				<NotificationsPanel
					onNavigate={() => setLayer(null)}
					open={layer === "notifications"}
				/>
			</Sheet>
			<FeedbackModal {...layerProps("feedback")} />
		</ShellActionsContext>
	);
}
