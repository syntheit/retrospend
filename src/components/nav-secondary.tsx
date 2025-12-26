"use client";

import { type Icon, IconSpeakerphone } from "@tabler/icons-react";
import type * as React from "react";

import { ThemeToggle } from "~/components/theme-toggle";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";

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
	return (
		<SidebarGroup {...props}>
			<SidebarGroupContent>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild>
							<a
								href="https://forms.gle/LgLS7wSJGWSjQYEs7"
								target="_blank"
								rel="noopener noreferrer"
							>
								<IconSpeakerphone />
								<span>Feedback</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<ThemeToggle />
					</SidebarMenuItem>
					{items.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton asChild>
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
