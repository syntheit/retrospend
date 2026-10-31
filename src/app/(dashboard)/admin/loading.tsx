import { PageFrame } from "~/components/layout/page-frame";
import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
	return (
		<PageFrame>
			<Skeleton className="mb-4 h-8 w-48" shape="line" />
			<div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
				{Array.from({ length: 8 }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
					<Skeleton className="h-12 w-24" key={i} shape="line" />
				))}
			</div>
			<Skeleton className="mt-8 h-10 w-full" shape="line" />
			<div className="mt-4 flex flex-col gap-2">
				{Array.from({ length: 6 }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
					<Skeleton className="h-ctl w-full" key={i} shape="line" />
				))}
			</div>
		</PageFrame>
	);
}
