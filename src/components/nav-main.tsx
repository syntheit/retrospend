"use client";

import { type Icon } from "@tabler/icons-react";
import { CirclePlus } from "lucide-react";
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
							className="group/add h-10 cursor-pointer border border-primary px-4 py-4 text-base text-primary transition-all duration-200 ease-out hover:-translate-y-[1px] hover:bg-primary/90 hover:text-primary-foreground hover:shadow-md hover:shadow-primary/20 active:translate-y-0 active:scale-[0.97] active:bg-primary/90 active:text-primary-foreground active:shadow-none [&>svg]:size-5"
							onClick={handleCreateExpense}
							size="lg"
							tooltip="Add Expense"
						>
							<CirclePlus className="transition-transform duration-200 ease-out group-hover/add:scale-110" />
							<span>Add Expense</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>

				{categories.map((category) => (
					<div className="flex flex-col gap-1" key={category.label}>
						<SidebarGroupLabel className="px-2 pt-2 text-muted-foreground text-xs">
							{category.label}
							{category.subtext && (
								<span className="ml-1 font-normal opacity-70">
									{category.subtext}
								</span>
							)}
						</SidebarGroupLabel>
						<SidebarMenu>
							{category.items.map((item) => {
								const isActive = !item.isPlaceholder && (pathname === item.url || (item.url !== "/dashboard" && pathname.startsWith(item.url + "/")));
								return (
								<SidebarMenuItem key={item.title}>
									{item.isPlaceholder ? (
										<SidebarMenuButton
											className="h-10 cursor-not-allowed px-4 py-4 text-base opacity-50 [&>svg]:size-5"
											disabled
											size="lg"
											tooltip={`${item.title} (Coming Soon)`}
										>
											{item.icon && <item.icon />}
											<span>{item.title}</span>
										</SidebarMenuButton>
									) : (
										<SidebarMenuButton
											asChild
											className={`h-10 px-4 py-4 text-base [&>svg]:size-5 ${isActive ? "bg-sidebar-accent" : ""}`}
											size="lg"
											tooltip={item.title}
										>
											<Link href={item.url!} aria-current={isActive ? "page" : undefined}>
												{item.icon && <item.icon />}
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									)}
								</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</div>
				))}
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
