import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-32" />
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-2">
				<Skeleton className="h-9 w-24" />
				<Skeleton className="h-9 w-24" />
				<Skeleton className="h-9 w-24" />
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				{/* Table */}
				<div className="rounded-xl border">
					<div className="flex items-center gap-4 border-b px-4 py-3">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-20" />
					</div>
					{Array.from({ length: 8 }).map((_, i) => (
						<div
							key={i}
							className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
						>
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-4 w-16" />
						</div>
					))}
				</div>

				{/* Sidebar */}
				<div className="flex flex-col gap-4">
					<Skeleton className="h-[300px] w-full rounded-xl" />
					<Skeleton className="h-32 rounded-xl" />
				</div>
			</div>
		</div>
	);
}
