"use client";

import { createContext, useContext } from "react";
import type { AddId } from "~/lib/nav";

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
