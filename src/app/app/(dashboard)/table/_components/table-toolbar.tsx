import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";

interface TableToolbarProps {
	onCreateExpense: () => void;
}

export function TableToolbar({ onCreateExpense }: TableToolbarProps) {
	return (
		<div className="flex items-center gap-2">
			{/* Add other toolbar items here like global export if needed */}
			<Button onClick={onCreateExpense} size="sm">
				<Plus className="mr-2 h-4 w-4" />
				New Expense
			</Button>
		</div>
	);
}
