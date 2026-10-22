"use client";

import { useTranslations } from "next-intl";
import {
	type CSSProperties,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { FeedbackModal } from "~/components/feedback-modal";
import { PageTransition } from "~/components/page-transition";
import { Sheet } from "~/components/ui/sheet";
import { SidebarProvider, useSidebar } from "~/components/ui/sidebar";
import { useToast } from "~/components/ui/toast";
import { ADD_ACTIONS, type AddId, type NavBadges } from "~/lib/nav";
import { AccountSheet } from "./account-sheet";
import { BottomNav, FloatingAdd } from "./bottom-nav";
import { NotificationsPanel } from "./notifications";
import { ShellPalette } from "./palette";
import { type ShellActions, ShellActionsContext } from "./shell-context";
import { shellShortcut } from "./shortcuts";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { ShellSidebar } from "./sidebar";
import { VerifyEmailNotice } from "./verify-email-notice";

type Layer = "palette" | "shortcuts" | "account" | "notifications" | "feedback";

/**
 * Today's pages still draw SiteHeader, whose menu button opens the old
 * phone sidebar. In the new shell that button opens the account sheet
 * instead (the places without a tab live there), and it is hidden on
 * desktop, where the sidebar is always shown. Goes away with SiteHeader (S4).
 */
function LegacyMenuBridge({ onOpen }: { onOpen: () => void }) {
	const { openMobile, setOpenMobile } = useSidebar();
	useEffect(() => {
		if (!openMobile) return;
		setOpenMobile(false);
		onOpen();
	}, [openMobile, setOpenMobile, onOpen]);
	return null;
}

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

// Today's SiteHeader reads --header-height from DashboardLayout's provider.
const PROVIDER_STYLE = {
	"--header-height": "calc(var(--spacing) * 12)",
} as CSSProperties;

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
 * The new app shell (uiV2Mode): sidebar on desktop and tablet, bottom bar
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
	const { openNewExpense } = useExpenseModal();
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
				openNewExpense();
			},
			openPalette: () => setLayer("palette"),
			openShortcuts: () => setLayer("shortcuts"),
			openAccountSheet: () => setLayer("account"),
			openNotificationsSheet: () => setLayer("notifications"),
			openFeedback: () => setLayer("feedback"),
		}),
		[openNewExpense, t, toast],
	);
	useShellKeys(actions, setLayer);
	useToastOffset();
	const desktop = useDesktop();

	return (
		<ShellActionsContext value={actions}>
			<SidebarProvider
				className="h-svh overflow-hidden bg-bg text-fg"
				style={PROVIDER_STYLE}
			>
				<LegacyMenuBridge onOpen={actions.openAccountSheet} />
				<a
					className="sr-only rounded-ctl bg-surface px-4 py-2 font-medium text-body focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:outline-2 focus:outline-brand"
					href="#main-content"
				>
					{t("skipToContent")}
				</a>
				{desktop && <ShellSidebar badges={badges} className="hidden md:flex" />}
				<main
					className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 md:[&_[data-sidebar=trigger]]:hidden md:[&_[data-sidebar=trigger]+[data-orientation=vertical]]:hidden"
					id="main-content"
				>
					<VerifyEmailNotice />
					<PageTransition>{children}</PageTransition>
				</main>
				<BottomNav badges={badges} className="md:hidden" />
				<FloatingAdd className="md:hidden" />
			</SidebarProvider>
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
