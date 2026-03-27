import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header bar */}
			<div className="flex items-center justify-between">
				<Skeleton className="h-8 w-48" />
			</div>

			{/* 3 card skeletons */}
			{Array.from({ length: 3 }).map((_, i) => (
				<div key={i} className="h-32 rounded-xl border p-4">
					<div className="flex flex-col gap-3">
						<Skeleton className="h-5 w-36" />
						<Skeleton className="h-4 w-64" />
						<Skeleton className="h-9 w-full" />
					</div>
				</div>
			))}
		</div>
	);
}
