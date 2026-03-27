import type { ReactNode } from "react";

interface PageContentProps {
	children: ReactNode;
	/** When true, the content area fills available height without scrolling (the child is responsible for its own scroll) */
	fill?: boolean;
}

export function PageContent({ children, fill }: PageContentProps) {
	if (fill) {
		return (
			<div className="flex flex-1 flex-col overflow-y-auto lg:overflow-hidden pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
				<div className="@container/main flex flex-1 flex-col min-h-0 px-4 lg:px-6">
					{children}
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
			<div className="@container/main flex flex-col gap-2 px-4 lg:px-6">
				<div className="flex flex-col gap-4">{children}</div>
			</div>
		</div>
	);
}
