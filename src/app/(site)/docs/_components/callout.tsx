import { AlertTriangle, Info, Lightbulb, XCircle } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "~/lib/utils"

type CalloutVariant = "info" | "warning" | "tip" | "danger"

const VARIANTS: Record<
	CalloutVariant,
	{
		icon: React.ElementType
		label: string
		containerClass: string
		iconClass: string
		titleClass: string
	}
> = {
	info: {
		icon: Info,
		label: "Note",
		containerClass: "border-blue-500/25 bg-blue-500/5",
		iconClass: "text-blue-500",
		titleClass: "text-blue-700 dark:text-blue-400",
	},
	warning: {
		icon: AlertTriangle,
		label: "Warning",
		containerClass: "border-amber-500/25 bg-amber-500/5",
		iconClass: "text-amber-500",
		titleClass: "text-amber-700 dark:text-amber-400",
	},
	tip: {
		icon: Lightbulb,
		label: "Tip",
		containerClass: "border-emerald-500/25 bg-emerald-500/5",
		iconClass: "text-emerald-500",
		titleClass: "text-emerald-700 dark:text-emerald-400",
	},
	danger: {
		icon: XCircle,
		label: "Danger",
		containerClass: "border-red-500/25 bg-red-500/5",
		iconClass: "text-red-500",
		titleClass: "text-red-700 dark:text-red-400",
	},
}

interface CalloutProps {
	variant?: CalloutVariant
	title?: string
	children: ReactNode
}

export function Callout({
	variant = "info",
	title,
	children,
}: CalloutProps) {
	const { icon: Icon, label, containerClass, iconClass, titleClass } =
		VARIANTS[variant]

	return (
		<div
			className={cn(
				"my-5 flex gap-3 rounded-lg border p-4",
				containerClass,
			)}
		>
			<Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
			<div className="min-w-0 flex-1 text-sm leading-relaxed">
				{(title ?? label) && (
					<p className={cn("mb-1 font-semibold", titleClass)}>
						{title ?? label}
					</p>
				)}
				<div className="text-foreground/80 [&_a]:underline [&_a]:underline-offset-2">
					{children}
				</div>
			</div>
		</div>
	)
}
