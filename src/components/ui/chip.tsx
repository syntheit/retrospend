import { cn } from "~/lib/utils";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	active?: boolean;
}

export function Chip({ active, className, ...props }: ChipProps) {
	return (
		<button
			type="button"
			className={cn(
				"inline-flex cursor-pointer items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-all",
				active
					? "bg-primary text-primary-foreground hover:bg-primary/90"
					: "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}
