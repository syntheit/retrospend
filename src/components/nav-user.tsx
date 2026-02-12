"use client";

import {
	IconDotsVertical,
	IconLogout,
	IconSettings,
	IconUserCircle,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "~/components/ui/sidebar";
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";

// Extend the session user type to include additional fields
type ExtendedUser = NonNullable<
	NonNullable<ReturnType<typeof useSession>["data"]>["user"]
> & {
	role: string;
	username: string;
	isActive: boolean;
};

function getUserInitials(name: string): string {
	if (!name || name.trim() === "") return "U";

	const nameParts = name.trim().split(/\s+/).filter(Boolean);
	if (nameParts.length === 0) return "U";
	if (nameParts.length === 1) {
		const firstPart = nameParts[0];
		return firstPart ? firstPart.charAt(0).toUpperCase() : "U";
	}

	// Return first letter of first name and first letter of last name
	const firstName = nameParts[0];
	const lastName = nameParts[nameParts.length - 1];
	if (!firstName || !lastName) return "U";
	return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
}

export function NavUser({
	user,
}: {
	user: {
		name: string;
		username: string;
		avatar: string;
	};
}) {
	const { isMobile } = useSidebar();
	const { data: session } = useSession();
	const router = useRouter();
	const userInitials = getUserInitials(user.name);
	const extendedUser = session?.user as ExtendedUser;
	const isAdmin = extendedUser?.role === "ADMIN";

	const handleLogout = async () => {
		try {
			await authClient.signOut();
			router.push("/login");
		} catch (error) {
			handleError(error, "Failed to log out");
		}
	};

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							size="lg"
						>
							<Avatar className="h-8 w-8 rounded-lg grayscale">
								<AvatarImage alt={user.name} src={user.avatar} />
								<AvatarFallback className="rounded-lg">
									{userInitials}
								</AvatarFallback>
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user.name}</span>
								<span className="truncate text-muted-foreground text-xs">
									@{user.username}
								</span>
							</div>
							<IconDotsVertical className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar className="h-8 w-8 rounded-lg">
									<AvatarImage alt={user.name} src={user.avatar} />
									<AvatarFallback className="rounded-lg">
										{userInitials}
									</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-muted-foreground text-xs">
										@{user.username}
									</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem asChild>
								<a className="cursor-pointer" href="/app/account">
									<IconUserCircle />
									Account
								</a>
							</DropdownMenuItem>
							{isAdmin && (
								<DropdownMenuItem asChild>
									<Link className="cursor-pointer" href="/app/admin">
										<IconSettings />
										Admin Panel
									</Link>
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
							<IconLogout />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
