"use client";

import { createContext, useContext } from "react";
import type { AddId } from "~/lib/nav";

/** Which shell a viewer gets, decided per request from uiV2Mode (src/server/flags.ts). */
export type ShellMode = "legacy" | "v2";

const ShellModeContext = createContext<ShellMode>("legacy");

/**
 * Carries the server's flag decision to client pages that draw the shell
 * themselves (the project page sits outside the dashboard layout).
 */
export function ShellModeProvider({
	mode,
	children,
}: {
	mode: ShellMode;
	children: React.ReactNode;
}) {
	return <ShellModeContext value={mode}>{children}</ShellModeContext>;
}

export function useShellMode(): ShellMode {
	return useContext(ShellModeContext);
}

/** The layers the shell owns, opened from the sidebar, the bars, the palette and keys. */
export type ShellActions = {
	add: (id: AddId) => void;
	openPalette: () => void;
	openShortcuts: () => void;
	openAccountSheet: () => void;
	openNotificationsSheet: () => void;
	openFeedback: () => void;
};

export const ShellActionsContext = createContext<ShellActions | null>(null);

export function useShellActions(): ShellActions {
	const actions = useContext(ShellActionsContext);
	if (!actions) throw new Error("useShellActions must be used inside AppShell");
	return actions;
}
