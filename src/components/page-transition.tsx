"use client";

import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<div
			key={pathname}
			className="flex flex-1 flex-col overflow-hidden"
			style={{
				animation: "page-enter 200ms cubic-bezier(0.25, 0.1, 0.25, 1) both",
			}}
		>
			{children}
		</div>
	);
}
