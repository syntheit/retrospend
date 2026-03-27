import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-9 w-32" />
			</div>

			{/* Stats */}
			<div className="grid grid-cols-3 gap-4">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="flex flex-col gap-2 rounded-xl border p-4">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-8 w-16" />
					</div>
				))}
			</div>

			{/* 3 person rows */}
			<div className="flex flex-col gap-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center justify-between rounded-xl border p-4"
					>
						<div className="flex items-center gap-3">
							<Skeleton className="h-10 w-10 rounded-full" />
							<div className="flex flex-col gap-1">
								<Skeleton className="h-4 w-32" />
								<Skeleton className="h-3 w-24" />
							</div>
						</div>
						<div className="flex items-center gap-3">
							<Skeleton className="h-8 w-24" />
							<Skeleton className="h-8 w-8" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
