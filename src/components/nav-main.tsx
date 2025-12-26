"use client";

import { type Icon, IconCirclePlusFilled } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useExpenseModal } from "~/components/expense-modal-provider";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";

export function NavMain({
	items,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
	}[];
}) {
	const pathname = usePathname();
	const { openNewExpense } = useExpenseModal();

	const handleCreateExpense = () => {
		openNewExpense();
	};

	return (
		<SidebarGroup>
			<SidebarGroupContent className="flex flex-col gap-2">
				<SidebarMenu>
					<SidebarMenuItem className="flex items-center gap-2">
						<SidebarMenuButton
							className="h-10 cursor-pointer border border-primary px-4 py-4 text-base text-primary duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground [&>svg]:size-5"
							onClick={handleCreateExpense}
							size="lg"
							tooltip="Add Expense"
						>
							<IconCirclePlusFilled />
							<span>Add Expense</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<SidebarMenu>
					{items.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								className={`h-10 px-4 py-4 text-base [&>svg]:size-5 ${pathname === item.url ? "bg-sidebar-accent" : ""}`}
								size="lg"
								tooltip={item.title}
							>
								<Link href={item.url}>
									{item.icon && <item.icon />}
									<span>{item.title}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
