"use client";

import {
	IconBriefcase,
	IconChartBar,
	IconCurrencyDollar,
	IconHome,
	IconPigMoney,
	IconSettings,
	IconTable,
} from "@tabler/icons-react";
import { NavMain } from "~/components/nav-main";
import { NavSecondary } from "~/components/nav-secondary";
import { NavUser } from "~/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";
import { useSession } from "~/hooks/use-session";
import { APP_VERSION } from "~/lib/version";

// Extend the session user type to include username
type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
};

const navMain = [
	{
		title: "Overview",
		url: "/app",
		icon: IconHome,
	},
	{
		title: "Table View",
		url: "/app/table",
		icon: IconTable,
	},
	{
		title: "Analytics",
		url: "/app/analytics",
		icon: IconChartBar,
	},
	{
		title: "Budget",
		url: "/app/budget",
		icon: IconPigMoney,
	},
	{
		title: "Exchange Rates",
		url: "/app/exchange-rates",
		icon: IconCurrencyDollar,
	},
	{
		title: "Wealth",
		url: "/app/wealth",
		icon: IconBriefcase,
	},
];

const navSecondary = [
	{
		title: "Settings",
		url: "/app/settings",
		icon: IconSettings,
	},
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { data: session, isPending } = useSession();

	const userData = session?.user
		? {
				name: session.user.name || "User", // Add fallback
				username: (session.user as ExtendedUser).username || "user", // Add fallback
				avatar: session.user.image || "",
			}
		: null;

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton className="data-[slot=sidebar-menu-button]:!p-1.5 pointer-events-none">
							<span className="font-semibold text-base">Retrospend</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navMain} />
				<NavSecondary className="mt-auto" items={navSecondary} />
			</SidebarContent>
			<SidebarFooter className="pt-1">
				<SidebarMenu>
					<SidebarMenuItem>
						<div className="px-2 text-muted-foreground text-sm">
							Version {APP_VERSION}
						</div>
					</SidebarMenuItem>
				</SidebarMenu>
				{isPending ? (
					<div className="p-4 text-muted-foreground text-sm">Loading...</div>
				) : userData ? (
					<NavUser user={userData} />
				) : (
					<div className="p-4 text-muted-foreground text-sm">
						Please sign in to access your account
					</div>
				)}
			</SidebarFooter>
		</Sidebar>
	);
}
