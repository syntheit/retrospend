"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useOverviewController } from "~/hooks/use-overview-controller";

type OverviewControllerReturn = ReturnType<typeof useOverviewController>;

export interface DashboardContextValue {
	state: OverviewControllerReturn["state"];
	data: OverviewControllerReturn["data"];
	isLoading: OverviewControllerReturn["isLoading"];
	actions: OverviewControllerReturn["actions"];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
	const controller = useOverviewController();

	return (
		<DashboardContext.Provider value={controller}>
			{children}
		</DashboardContext.Provider>
	);
}

export function useDashboardContext(): DashboardContextValue {
	const ctx = useContext(DashboardContext);
	if (!ctx) {
		throw new Error("useDashboardContext must be used within a DashboardProvider");
	}
	return ctx;
}
