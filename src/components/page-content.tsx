import type { ReactNode } from "react";

interface PageContentProps {
	children: ReactNode;
}

export function PageContent({ children }: PageContentProps) {
	return (
		<div className="flex flex-1 flex-col overflow-y-auto py-4 md:py-6">
			<div className="@container/main flex flex-col gap-2 px-4 lg:px-6">
				<div className="flex flex-col gap-4">{children}</div>
			</div>
		</div>
	);
}
