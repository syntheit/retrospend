"use client";

import {
	IconWallet,
	IconRepeat,
	IconCoins,
	IconFileImport,
	IconFolder,
	IconLayoutDashboard,
	IconPigMoney,
	IconReceipt,
	IconUsersGroup,
} from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
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
	useSidebar,
} from "~/components/ui/sidebar";
import { useSession } from "~/hooks/use-session";
import { APP_VERSION } from "~/lib/version";

// Extend the session user type to include username
type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
};

const navMainCategories = [
	{
		label: "Core",
		items: [
			{
				title: "Dashboard",
				url: "/dashboard",
				icon: IconLayoutDashboard,
			},
			{
				title: "Transactions",
				url: "/transactions",
				icon: IconReceipt,
			},
			{
				title: "Budget",
				url: "/budget",
				icon: IconPigMoney,
			},
			{
				title: "Recurring",
				url: "/recurring",
				icon: IconRepeat,
			},
		],
	},
	{
		label: "Shared",
		items: [
			{
				title: "People",
				url: "/people",
				icon: IconUsersGroup,
			},
			{
				title: "Projects",
				url: "/projects",
				icon: IconFolder,
			},
		],
	},
	{
		label: "Tools",
		items: [
			{
				title: "Import",
				url: "/import",
				icon: IconFileImport,
			},
			{
				title: "Wealth",
				url: "/wealth",
				icon: IconWallet,
			},
			{
				title: "Currencies",
				url: "/currencies",
				icon: IconCoins,
			},
		],
	},
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { data: session, isPending } = useSession();
	const _pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers effect intentionally
	useEffect(() => {
		if (isMobile) {
			setOpenMobile(false);
		}
	}, [_pathname, isMobile, setOpenMobile]);

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
				<NavMain categories={navMainCategories} />
				<NavSecondary className="mt-auto" items={[]} />
			</SidebarContent>
			<SidebarFooter className="pt-1 pb-[env(safe-area-inset-bottom)]">
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
