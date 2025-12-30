"use client";

import { type Icon, IconSpeakerphone, IconTicket } from "@tabler/icons-react";
import type * as React from "react";

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";
import { api } from "~/trpc/react";

export function NavSecondary({
	items,
	...props
}: {
	items: {
		title: string;
		url: string;
		icon: Icon;
	}[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
	const { data: settings } = api.user.getSettings.useQuery();

	return (
		<SidebarGroup {...props}>
			<SidebarGroupContent>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							className="h-10 px-4 py-4 text-base [&>svg]:size-5"
						>
							<a
								href="https://forms.gle/LgLS7wSJGWSjQYEs7"
								rel="noopener noreferrer"
								target="_blank"
							>
								<IconSpeakerphone />
								<span>Feedback</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
					{settings?.allowAllUsersToGenerateInvites && (
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								className="h-10 px-4 py-4 text-base [&>svg]:size-5"
							>
								<a href="/app/invite-codes">
									<IconTicket />
									<span>Invite Codes</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}
					{items.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								className="h-10 px-4 py-4 text-base [&>svg]:size-5"
							>
								<a href={item.url}>
									<item.icon />
									<span>{item.title}</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
