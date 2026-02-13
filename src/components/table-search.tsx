import { IconSearch, IconX } from "@tabler/icons-react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

interface TableSearchProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
}

export function TableSearch({
	value,
	onChange,
	placeholder = "Search...",
	className,
}: TableSearchProps) {
	return (
		<div className={cn("relative w-full", className)}>
			<IconSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				className="pr-9 pl-9"
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				value={value}
			/>
			{value && (
				<button
					className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
					onClick={() => onChange("")}
					type="button"
				>
					<IconX className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
