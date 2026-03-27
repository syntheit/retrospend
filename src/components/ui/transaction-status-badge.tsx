import { Badge } from "~/components/ui/badge";

interface TransactionStatusBadgeProps {
	status: string;
}

export function TransactionStatusBadge({
	status,
}: TransactionStatusBadgeProps) {
	switch (status) {
		case "active":
			return (
				<Badge
					className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					variant="outline"
				>
					Confirmed
				</Badge>
			);
		case "pending":
			return (
				<Badge
					className="bg-amber-500/10 text-amber-600 dark:text-amber-400"
					variant="outline"
				>
					Needs Review
				</Badge>
			);
		case "settled":
			return (
				<Badge className="text-muted-foreground" variant="outline">
					Settled
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
