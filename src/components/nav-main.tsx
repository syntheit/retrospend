"use client";

import { type Icon, IconCirclePlusFilled } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useExpenseModal } from "~/components/expense-modal-provider";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";

export function NavMain({
	categories,
}: {
	categories: {
		label: string;
		subtext?: string;
		items: {
			title: string;
			url?: string;
			icon?: Icon;
			isPlaceholder?: boolean;
		}[];
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

				{categories.map((category) => (
					<div key={category.label} className="flex flex-col gap-1">
						<SidebarGroupLabel className="px-2 pt-2 text-muted-foreground text-xs">
							{category.label}
							{category.subtext && (
								<span className="ml-1 font-normal opacity-70">
									{category.subtext}
								</span>
							)}
						</SidebarGroupLabel>
						<SidebarMenu>
							{category.items.map((item) => (
								<SidebarMenuItem key={item.title}>
									{item.isPlaceholder ? (
										<SidebarMenuButton
											className="h-10 cursor-not-allowed px-4 py-4 text-base opacity-50 [&>svg]:size-5"
											size="lg"
											tooltip={`${item.title} (Coming Soon)`}
											disabled
										>
											{item.icon && <item.icon />}
											<span>{item.title}</span>
										</SidebarMenuButton>
									) : (
										<SidebarMenuButton
											asChild
											className={`h-10 px-4 py-4 text-base [&>svg]:size-5 ${pathname === item.url ? "bg-sidebar-accent" : ""}`}
											size="lg"
											tooltip={item.title}
										>
											<Link href={item.url!}>
												{item.icon && <item.icon />}
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									)}
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</div>
				))}
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
