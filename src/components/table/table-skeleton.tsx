"use client";

import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/cn";

/** Column shapes of the loading table: lead tile, title, meta, money. */
const SHAPE = ["w-4", "w-2/3", "w-24", "w-20", "w-16"];

/**
 * Loading state of a table (R14): the table's own frame with its header
 * band and rows of placeholders at row height, money on the right edge,
 * so nothing jumps when the rows arrive.
 */
export function TableSkeleton({
	rows = 5,
	className,
}: {
	rows?: number;
	className?: string;
}) {
	return (
		<Table
			aria-busy="true"
			look="panel"
			wrapperClassName={cn("overflow-hidden", className)}
		>
			<TableHeader>
				<TableRow>
					{SHAPE.map((w, i) => (
						<TableHead
							className={i === SHAPE.length - 1 ? "text-right" : undefined}
							key={w}
						>
							<Skeleton
								className={cn("h-2.5", w, i === SHAPE.length - 1 && "ml-auto")}
								shape="line"
							/>
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{Array.from({ length: rows }, (_, r) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					<TableRow key={r}>
						<TableCell>
							<Skeleton className="size-4" shape="tile" />
						</TableCell>
						<TableCell>
							<Skeleton className="w-1/2" shape="line" />
						</TableCell>
						<TableCell>
							<Skeleton className="w-20" shape="line" />
						</TableCell>
						<TableCell>
							<Skeleton className="w-16" shape="line" />
						</TableCell>
						<TableCell>
							<Skeleton className="ml-auto" shape="money" />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
