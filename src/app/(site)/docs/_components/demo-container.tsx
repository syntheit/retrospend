import { Badge } from "~/components/ui/badge"
import { cn } from "~/lib/utils"

interface DemoContainerProps {
	title?: string
	children: React.ReactNode
	className?: string
}

export function DemoContainer({ title, children, className }: DemoContainerProps) {
	return (
		<div className={cn("my-6 overflow-hidden rounded-xl border bg-muted/20", className)}>
			{title && (
				<div className="flex items-center gap-2 border-b px-4 py-2.5">
					<span className="font-medium text-sm">{title}</span>
					<Badge variant="secondary" className="text-[10px]">Live Demo</Badge>
				</div>
			)}
			<div className="p-4">{children}</div>
		</div>
	)
}
