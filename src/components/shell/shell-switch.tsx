"use client";

import dynamic from "next/dynamic";
import { CommandPalette } from "~/components/command-palette";
import { DashboardLayout } from "~/components/dashboard-layout";
import { useShellMode } from "./shell-context";

// Loaded only for viewers with the new shell, so guest, public and legacy
// project pages do not ship it.
const AppShell = dynamic(() => import("./app-shell").then((m) => m.AppShell));

/**
 * The shell for a client page that draws its own (the project page sits
 * outside the dashboard layout). The mode comes from the route's layout,
 * which reads uiV2Mode for the viewer; legacy renders exactly today's
 * DashboardLayout and CommandPalette.
 */
export function ShellSwitch({ children }: { children: React.ReactNode }) {
	const mode = useShellMode();
	if (mode === "v2") return <AppShell>{children}</AppShell>;
	return (
		<>
			<DashboardLayout>{children}</DashboardLayout>
			<CommandPalette />
		</>
	);
}
