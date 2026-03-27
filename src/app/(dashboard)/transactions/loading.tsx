import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-36" />
			</div>

			{/* Filter bar */}
			<div className="flex items-center gap-3">
				<Skeleton className="h-9 w-64" />
				<Skeleton className="h-9 w-28" />
				<Skeleton className="h-9 w-28" />
				<Skeleton className="h-9 w-28" />
			</div>

			{/* Table header */}
			<div className="rounded-xl border">
				<div className="flex items-center gap-4 border-b px-4 py-3">
					<Skeleton className="h-4 w-8" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-20" />
				</div>

				{/* Table rows */}
				{Array.from({ length: 10 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
					>
						<Skeleton className="h-4 w-8" />
						<Skeleton className="h-4 w-40" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}
