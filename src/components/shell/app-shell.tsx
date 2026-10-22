"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { FeedbackModal } from "~/components/feedback-modal";
import { PageTransition } from "~/components/page-transition";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { SidebarProvider, useSidebar } from "~/components/ui/sidebar";
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

function useShellKeys(actions: ShellActions, setLayer: (l: Layer) => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const hit = shellShortcut(e);
			if (!hit) return;
			e.preventDefault();
			if (hit.kind === "palette") setLayer("palette");
			else if (hit.kind === "shortcuts") setLayer("shortcuts");
			else actions.add(hit.id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [actions, setLayer]);
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
					toast(t("add.notYet", { what: t(`add.${id}`) }));
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
		[openNewExpense, t],
	);
	useShellKeys(actions, setLayer);

	return (
		<ShellActionsContext value={actions}>
			<SidebarProvider className="h-svh overflow-hidden bg-bg text-fg">
				<LegacyMenuBridge onOpen={actions.openAccountSheet} />
				<a
					className="sr-only rounded-ctl bg-surface px-4 py-2 font-medium text-body focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:outline-2 focus:outline-brand"
					href="#main-content"
				>
					{t("skipToContent")}
				</a>
				<ShellSidebar badges={badges} className="hidden md:flex" />
				<main
					className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 md:[&_[data-sidebar=trigger]]:hidden md:[&_[data-sidebar=trigger]+[data-orientation=vertical]]:hidden"
					id="main-content"
				>
					<PageTransition>{children}</PageTransition>
				</main>
				<BottomNav badges={badges} className="md:hidden" />
				<FloatingAdd className="md:hidden" />
			</SidebarProvider>
			<ShellPalette {...layerProps("palette")} />
			<ShortcutsSheet {...layerProps("shortcuts")} />
			<AccountSheet {...layerProps("account")} />
			<ResponsiveDialog {...layerProps("notifications")}>
				<ResponsiveDialogContent className="gap-2 rounded-t-panel border-line bg-surface px-0 text-fg">
					<ResponsiveDialogHeader className="px-4">
						<ResponsiveDialogTitle className="text-section">
							{t("notifications.title")}
						</ResponsiveDialogTitle>
					</ResponsiveDialogHeader>
					<NotificationsPanel
						onNavigate={() => setLayer(null)}
						open={layer === "notifications"}
					/>
				</ResponsiveDialogContent>
			</ResponsiveDialog>
			<FeedbackModal {...layerProps("feedback")} />
		</ShellActionsContext>
	);
}
