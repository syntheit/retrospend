import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
			</div>

			{/* Tab bar */}
			<div className="flex items-center gap-2">
				{Array.from({ length: 5 }).map((_, i) => (
					<Skeleton key={i} className="h-9 w-24" />
				))}
			</div>

			{/* 4 stat cards */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="flex flex-col gap-2 rounded-xl border p-4">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-8 w-32" />
						<Skeleton className="h-3 w-20" />
					</div>
				))}
			</div>

			{/* Table */}
			<div className="rounded-xl border">
				<div className="flex items-center gap-4 border-b px-4 py-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-4 w-20" />
				</div>
				{Array.from({ length: 6 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
					>
						<Skeleton className="h-4 w-36" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-4 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}
