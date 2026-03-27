"use client";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider
			className="h-svh overflow-hidden"
			style={
				{
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<a
				className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
				href="#main-content"
			>
				Skip to main content
			</a>
			<AppSidebar variant="inset" />
			<SidebarInset className="flex flex-col overflow-hidden">
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
