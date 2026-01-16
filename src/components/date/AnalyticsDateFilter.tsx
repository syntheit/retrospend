"use client";

import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

type Preset = {
	label: string;
	value: string;
	getRange: () => { from: Date; to: Date };
};

const getPresets = (): Preset[] => {
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth();

	return [
		{
			label: "This Month",
			value: "this-month",
			getRange: () => ({
				from: new Date(currentYear, currentMonth, 1),
				to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
			}),
		},
		{
			label: "Last Month",
			value: "last-month",
			getRange: () => ({
				from: new Date(currentYear, currentMonth - 1, 1),
				to: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999),
			}),
		},
		{
			label: "Last 3 Months",
			value: "last-3-months",
			getRange: () => ({
				from: new Date(currentYear, currentMonth - 2, 1),
				to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
			}),
		},
		{
			label: "Last 6 Months",
			value: "last-6-months",
			getRange: () => ({
				from: new Date(currentYear, currentMonth - 5, 1),
				to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
			}),
		},
		{
			label: "Year to Date",
			value: "year-to-date",
			getRange: () => ({
				from: new Date(currentYear, 0, 1),
				to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
			}),
		},
		{
			label: "Last Year",
			value: "last-year",
			getRange: () => ({
				from: new Date(currentYear - 1, 0, 1),
				to: new Date(currentYear - 1, 11, 31, 23, 59, 59, 999),
			}),
		},
	];
};

function formatDateForUrl(date: Date): string {
	return format(date, "yyyy-MM-dd");
}

function parseDateFromUrl(dateStr: string): Date | null {
	const parsed = new Date(dateStr);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDefaultRange(): { from: Date; to: Date } {
	const presets = getPresets();
	const last6Months = presets.find((p) => p.value === "last-6-months");
	const preset = last6Months ?? presets[0];
	if (!preset) {
		throw new Error("No presets available");
	}
	return preset.getRange();
}

export function AnalyticsDateFilter() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [showCalendar, setShowCalendar] = useState(false);
	const [calendarRange, setCalendarRange] = useState<DateRange | undefined>();

	const presets = useMemo(() => getPresets(), []);

	// Parse current range from URL
	const currentRange = useMemo(() => {
		const fromParam = searchParams.get("from");
		const toParam = searchParams.get("to");

		if (fromParam && toParam) {
			const from = parseDateFromUrl(fromParam);
			const to = parseDateFromUrl(toParam);
			if (from && to) {
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
		}

		return getDefaultRange();
	}, [searchParams]);

	// Determine the display label
	const displayLabel = useMemo(() => {
		const fromParam = searchParams.get("from");
		const toParam = searchParams.get("to");

		if (!fromParam || !toParam) {
			return "Last 6 Months";
		}

		// Check if it matches a preset
		const matchingPreset = presets.find((preset) => {
			const range = preset.getRange();
			return (
				fromParam === formatDateForUrl(range.from) &&
				toParam === formatDateForUrl(range.to)
			);
		});

		if (matchingPreset) {
			return matchingPreset.label;
		}

		// Custom range - show formatted dates
		const from = parseDateFromUrl(fromParam);
		const to = parseDateFromUrl(toParam);
		if (from && to) {
			const formatOpts: Intl.DateTimeFormatOptions = {
				month: "short",
				day: "numeric",
			};
			const yearOpts: Intl.DateTimeFormatOptions = {
				...formatOpts,
				year: "numeric",
			};

			// Include year if dates span multiple years
			if (from.getFullYear() !== to.getFullYear()) {
				return `${from.toLocaleDateString("en-US", yearOpts)} - ${to.toLocaleDateString("en-US", yearOpts)}`;
			}
			return `${from.toLocaleDateString("en-US", formatOpts)} - ${to.toLocaleDateString("en-US", yearOpts)}`;
		}

		return "Last 6 Months";
	}, [searchParams, presets]);

	const updateUrl = useCallback(
		(from: Date, to: Date) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("from", formatDateForUrl(from));
			params.set("to", formatDateForUrl(to));
			router.push(`?${params.toString()}`);
		},
		[router, searchParams],
	);

	const handlePresetSelect = useCallback(
		(preset: Preset) => {
			const range = preset.getRange();
			updateUrl(range.from, range.to);
			setOpen(false);
			setShowCalendar(false);
		},
		[updateUrl],
	);

	const handleCustomRangeClick = useCallback(() => {
		setCalendarRange({ from: currentRange.from, to: currentRange.to });
		setShowCalendar(true);
	}, [currentRange]);

	const handleCalendarSelect = useCallback((range: DateRange | undefined) => {
		setCalendarRange(range);
	}, []);

	const handleApplyRange = useCallback(() => {
		if (calendarRange?.from && calendarRange?.to) {
			const to = new Date(calendarRange.to);
			to.setHours(23, 59, 59, 999);
			updateUrl(calendarRange.from, to);
			setOpen(false);
			setShowCalendar(false);
		}
	}, [calendarRange, updateUrl]);

	const handleBack = useCallback(() => {
		setShowCalendar(false);
	}, []);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button className="gap-2" variant="outline">
					<CalendarIcon className="h-4 w-4" />
					<span className="hidden sm:inline">{displayLabel}</span>
					<ChevronDown className="h-4 w-4 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-auto p-0">
				{!showCalendar ? (
					<div className="flex flex-col">
						<div className="flex flex-col p-2">
							{presets.map((preset) => (
								<Button
									className={cn(
										"justify-start font-normal",
										displayLabel === preset.label && "bg-accent",
									)}
									key={preset.value}
									onClick={() => handlePresetSelect(preset)}
									variant="ghost"
								>
									{preset.label}
								</Button>
							))}
						</div>
						<div className="border-t" />
						<div className="p-2">
							<Button
								className="w-full justify-start font-normal"
								onClick={handleCustomRangeClick}
								variant="ghost"
							>
								Custom Range...
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col">
						<div className="border-b p-2">
							<Button
								className="gap-1"
								onClick={handleBack}
								size="sm"
								variant="ghost"
							>
								← Back
							</Button>
						</div>
						<Calendar
							defaultMonth={calendarRange?.from}
							mode="range"
							numberOfMonths={2}
							onSelect={handleCalendarSelect}
							selected={calendarRange}
						/>
						<div className="border-t p-2">
							<Button
								className="w-full"
								disabled={!calendarRange?.from || !calendarRange?.to}
								onClick={handleApplyRange}
							>
								Apply Range
							</Button>
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
