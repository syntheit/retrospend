import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-36" />
			</div>

			{/* Filter tabs */}
			<div className="flex items-center gap-2">
				<Skeleton className="h-9 w-20" />
				<Skeleton className="h-9 w-24" />
				<Skeleton className="h-9 w-28" />
			</div>

			{/* 6 project cards */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="h-32 rounded-xl border p-4">
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<Skeleton className="h-5 w-32" />
								<Skeleton className="h-5 w-16" />
							</div>
							<Skeleton className="h-3 w-48" />
							<div className="flex items-center gap-2">
								<Skeleton className="h-6 w-6 rounded-full" />
								<Skeleton className="h-6 w-6 rounded-full" />
								<Skeleton className="h-6 w-6 rounded-full" />
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
