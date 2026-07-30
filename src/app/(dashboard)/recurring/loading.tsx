import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div
			className="flex flex-1 flex-col gap-6 p-6"
			style={{ animation: "skeleton-delayed-in 150ms ease-out 200ms both" }}
		>
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-8 w-36" />
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				{/* Main column */}
				<div className="min-w-0 space-y-6 lg:col-span-8">
					{/* 2 stat cards */}
					<div className="grid gap-4 md:grid-cols-2">
						<Skeleton className="h-32 w-full rounded-xl" />
						<Skeleton className="h-32 w-full rounded-xl" />
					</div>

					{/* Subscriptions table */}
					<div className="space-y-4">
						<Skeleton className="h-6 w-40" />
						<div className="overflow-hidden rounded-xl border">
							<div className="border-b px-4 py-3">
								<Skeleton className="h-4 w-32" />
							</div>
							{Array.from({ length: 5 }).map((_, i) => (
								<div
									className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
									key={i}
								>
									<Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
									<Skeleton className="h-4 w-36" />
									<Skeleton className="ml-auto h-4 w-20" />
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Sidebar — calendar + projections */}
				<aside className="hidden space-y-6 lg:col-span-4 lg:block">
					<Skeleton className="h-80 w-full rounded-xl" />
					<Skeleton className="h-28 w-full rounded-xl" />
				</aside>
			</div>
		</div>
	);
}
