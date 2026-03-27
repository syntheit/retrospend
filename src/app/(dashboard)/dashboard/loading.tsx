import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-32" />
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

			{/* 2-column grid: chart + activity */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-[300px] w-full rounded-xl" />
				<Skeleton className="h-[300px] w-full rounded-xl" />
			</div>
		</div>
	);
}
