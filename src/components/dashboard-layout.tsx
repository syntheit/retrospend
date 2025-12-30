"use client";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider
			className="h-svh overflow-hidden"
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<AppSidebar variant="inset" />
			<SidebarInset className="flex flex-col overflow-hidden">
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
