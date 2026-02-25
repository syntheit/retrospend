"use client";

import { IconMoon, IconSun } from "@tabler/icons-react";
import { useThemeContext } from "~/components/theme-provider";
import { SidebarMenuButton } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
	const { theme, setTheme } = useThemeContext();

	const toggleTheme = () => {
		setTheme(theme === "light" ? "dark" : "light");
	};

	return (
		<SidebarMenuButton
			className={cn("cursor-pointer", className)}
			onClick={toggleTheme}
		>
			{theme === "light" ? (
				<IconMoon className="h-4 w-4" />
			) : (
				<IconSun className="h-4 w-4" />
			)}
			<span>Toggle theme</span>
		</SidebarMenuButton>
	);
}
