import { cn } from "~/lib/utils";

type Shape = "line" | "tile" | "face" | "money";

/**
 * The design's placeholder shapes: raised fill, pulsing (opacity only, so it
 * survives reduced motion as a fade). `line` is one line of text, `tile` the
 * 32px row lead, `face` an avatar, `money` an amount the width of a number.
 * Without `shape` it keeps the old look for today's pages.
 */
const SHAPE: Record<Shape, string> = {
	line: "h-3 w-full rounded-chip",
	tile: "size-8 rounded-ctl",
	face: "size-8 rounded-chip",
	money: "h-3.5 w-18 rounded-chip",
};

function Skeleton({
	className,
	shape,
	...props
}: React.ComponentProps<"div"> & { shape?: Shape }) {
	return (
		<div
			aria-hidden={shape ? true : undefined}
			className={cn(
				shape
					? cn("block shrink-0 animate-pulse bg-raised", SHAPE[shape])
					: "animate-pulse rounded-md bg-accent",
				className,
			)}
			data-slot="skeleton"
			{...props}
		/>
	);
}

/**
 * Loading rows in place (R14): the shape of a list row (lead, title and
 * subline, money at the end), at row height, so nothing jumps when the
 * data arrives.
 */
function SkeletonRows({
	count = 3,
	className,
}: {
	count?: number;
	className?: string;
}) {
	return (
		<div aria-busy="true" className={cn("flex flex-col", className)}>
			{Array.from({ length: count }, (_, i) => (
				<div
					className="flex min-h-row items-center gap-3 border-line border-b py-2 last:border-b-0"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={i}
				>
					<Skeleton shape="tile" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="w-1/2" shape="line" />
						<Skeleton className="w-1/3" shape="line" />
					</div>
					<Skeleton shape="money" />
				</div>
			))}
		</div>
	);
}

export { Skeleton, SkeletonRows };
