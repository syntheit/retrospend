"use client";

import { cn } from "~/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

// All colors pass WCAG AA 4.5:1 contrast ratio with white text.
// Using Tailwind -700 variants instead of the brighter -500 defaults.
const AVATAR_COLORS = [
	"#4338ca", // indigo-700   ~7.6:1
	"#6d28d9", // violet-700   ~6.8:1
	"#be185d", // pink-700     ~5.8:1
	"#be123c", // rose-700     ~6.1:1
	"#c2410c", // orange-700   ~5.0:1
	"#b45309", // amber-700    ~4.7:1
	"#15803d", // green-700    ~4.7:1
	"#0e7490", // cyan-700     ~5.0:1
	"#1d4ed8", // blue-700     ~6.3:1
	"#7e22ce", // purple-700   ~6.6:1
];

function getAvatarColor(name: string): string {
	let sum = 0;
	for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
	return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

function getAvatarInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) {
		const p = parts[0]!;
		return p.length >= 2
			? (p[0]! + p[1]!).toUpperCase()
			: p[0]!.toUpperCase();
	}
	return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const SIZE_CLASSES: Record<string, string> = {
	xs: "h-6 w-6 text-[10px]",
	sm: "h-8 w-8 text-xs",
	md: "h-10 w-10 text-sm",
	lg: "h-14 w-14 text-base",
	xl: "h-20 w-20 text-xl",
};

interface UserAvatarProps {
	name: string;
	avatarUrl?: string | null;
	size?: "xs" | "sm" | "md" | "lg" | "xl";
	className?: string;
}

export function UserAvatar({
	name,
	avatarUrl,
	size = "md",
	className,
}: UserAvatarProps) {
	const initials = getAvatarInitials(name);
	const color = getAvatarColor(name);
	const sizeClass = SIZE_CLASSES[size]!;

	return (
		<Avatar className={cn(sizeClass, className)}>
			{avatarUrl && (
				<AvatarImage
					alt={`${name}'s avatar`}
					loading="lazy"
					src={avatarUrl}
				/>
			)}
			<AvatarFallback
				className="font-semibold text-white"
				style={{ backgroundColor: color }}
			>
				{initials}
			</AvatarFallback>
		</Avatar>
	);
}
