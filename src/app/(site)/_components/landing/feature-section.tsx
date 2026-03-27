import { cn } from "~/lib/utils";

interface FeatureSectionProps {
	id: string;
	title: string;
	description: string;
	children: React.ReactNode;
	className?: string;
}

export function FeatureSection({
	id,
	title,
	description,
	children,
	className,
}: FeatureSectionProps) {
	return (
		<section className={cn("py-16 lg:py-24", className)} id={id}>
			<div className="mx-auto max-w-6xl px-4">
				<div className="mb-10 text-center">
					<h2 className="font-bold text-3xl tracking-tight">{title}</h2>
					<p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
						{description}
					</p>
				</div>
				{children}
			</div>
		</section>
	);
}
