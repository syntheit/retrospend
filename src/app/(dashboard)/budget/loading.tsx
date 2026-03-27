import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
				<div className="flex items-center gap-2">
					<Skeleton className="h-9 w-9" />
					<Skeleton className="h-9 w-32" />
					<Skeleton className="h-9 w-9" />
				</div>
			</div>

			{/* Budget summary card */}
			<div className="h-32 rounded-xl border p-4">
				<div className="flex flex-col gap-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-3 w-full rounded-full" />
				</div>
			</div>

			{/* 5 budget row skeletons */}
			<div className="flex flex-col gap-3">
				{Array.from({ length: 5 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center justify-between rounded-xl border p-4"
					>
						<div className="flex items-center gap-3">
							<Skeleton className="h-8 w-8 rounded-full" />
							<div className="flex flex-col gap-1">
								<Skeleton className="h-4 w-28" />
								<Skeleton className="h-3 w-20" />
							</div>
						</div>
						<div className="flex flex-col items-end gap-1">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-2 w-32 rounded-full" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
