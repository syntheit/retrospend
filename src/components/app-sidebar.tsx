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
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const t = useTranslations("sidebar");
	const tCommon = useTranslations("common");
	const { data: session, isPending } = useSession();
	const _pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();

	const navMainCategories = useMemo(() => [
		{
			label: t("core"),
			items: [
				{ title: t("dashboard"), url: "/dashboard", icon: IconLayoutDashboard },
				{ title: t("transactions"), url: "/transactions", icon: IconReceipt },
				{ title: t("budget"), url: "/budget", icon: IconPigMoney },
				{ title: t("recurring"), url: "/recurring", icon: IconRepeat },
			],
		},
		{
			label: t("shared"),
			items: [
				{ title: t("people"), url: "/people", icon: IconUsersGroup },
				{ title: t("projects"), url: "/projects", icon: IconFolder },
			],
		},
		{
			label: t("tools"),
			items: [
				{ title: t("import"), url: "/import", icon: IconFileImport },
				{ title: t("wealth"), url: "/wealth", icon: IconWallet },
				{ title: t("currencies"), url: "/currencies", icon: IconCoins },
			],
		},
	], [t]);

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
							{tCommon("version", { version: APP_VERSION })}
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
