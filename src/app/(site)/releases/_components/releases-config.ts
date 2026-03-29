import type { ComponentType } from "react"
import ReleaseV040 from "../_releases/v0-4-0"
import ReleaseV043 from "../_releases/v0-4-3"

export type ReleaseEntry = {
	version: string
	date: string // YYYY-MM-DD
	title: string
	component: ComponentType
}

// Newest first
export const RELEASES: ReleaseEntry[] = [
	{
		version: "0.4.3",
		date: "2026-03-29",
		title: "Search, Navigation & UI Polish",
		component: ReleaseV043,
	},
	{
		version: "0.4.0",
		date: "2026-03-28",
		title: "Shared Expenses, Projects & Guest Access",
		component: ReleaseV040,
	},
]
