import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-32" />
			</div>

			{/* 3 summary cards */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="h-32 rounded-xl border p-4">
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-8 w-32" />
							<Skeleton className="h-3 w-20" />
						</div>
					</div>
				))}
			</div>

			{/* Chart row */}
			<Skeleton className="h-[300px] w-full rounded-xl" />

			{/* Table row */}
			<div className="rounded-xl border">
				<div className="flex items-center gap-4 border-b px-4 py-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-20" />
				</div>
				{Array.from({ length: 5 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
					>
						<Skeleton className="h-4 w-36" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}
