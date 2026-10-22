"use client";

import { CommandPalette } from "~/components/command-palette";
import { DashboardLayout } from "~/components/dashboard-layout";
import { AppShell } from "./app-shell";
import { useShellMode } from "./shell-context";

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
