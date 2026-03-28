"use client";

import { addMonths, format, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

interface MonthStepperProps {
	value: Date | null;
	onChange: (date: Date) => void;
	/** Called when the selected month is clicked again to deselect */
	onClear?: () => void;
	/** If true, disables navigation to future months */
	maxDate?: Date;
	/** If true, disables navigation to past months */
	minDate?: Date;
	/** Compact mode: no step arrows, smaller trigger styled as a filter input */
	compact?: boolean;
	placeholder?: string;
	className?: string;
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function MonthStepper({
	value,
	onChange,
	onClear,
	maxDate,
	minDate,
	compact,
	placeholder = "Pick a month",
	className,
}: MonthStepperProps) {
	const [open, setOpen] = useState(false);
	const [popoverYear, setPopoverYear] = useState(
		() => value?.getFullYear() ?? new Date().getFullYear(),
	);

	const [now, setNow] = useState<Date | null>(null);

	// Hydrate "now" on client only to avoid hydration mismatch
	useEffect(() => {
		setNow(new Date());
	}, []);

	const effectiveMaxDate = useMemo(() => {
		// During SSR/Hydration, we can't safely know "now" without hydration error if times differ.
		// Use "now" state if available (client-side), otherwise fallback to safe default.
		return maxDate ?? (now || new Date());
	}, [maxDate, now]);

	const canGoForward = useMemo(() => {
		if (!value) return false;
		const nextMonth = addMonths(value, 1);
		return nextMonth <= effectiveMaxDate;
	}, [value, effectiveMaxDate]);

	const canGoBackward = useMemo(() => {
		if (!value) return false;
		if (!minDate) return true;
		const prevMonth = subMonths(value, 1);
		return prevMonth >= minDate;
	}, [value, minDate]);

	const handlePrevious = useCallback(() => {
		if (value && canGoBackward) {
			onChange(subMonths(value, 1));
		}
	}, [value, onChange, canGoBackward]);

	const handleNext = useCallback(() => {
		if (value && canGoForward) {
			onChange(addMonths(value, 1));
		}
	}, [value, onChange, canGoForward]);

	const handleMonthSelect = useCallback(
		(monthIndex: number) => {
			// Toggle off if clicking the already-selected month
			if (
				onClear &&
				value &&
				value.getFullYear() === popoverYear &&
				value.getMonth() === monthIndex
			) {
				onClear();
				setOpen(false);
				return;
			}
			const newDate = new Date(popoverYear, monthIndex, 1);
			// Prevent selecting future months
			if (newDate > effectiveMaxDate) return;
			// Prevent selecting months before minDate
			if (minDate && newDate < minDate) return;
			onChange(newDate);
			setOpen(false);
		},
		[popoverYear, effectiveMaxDate, minDate, onChange, onClear, value],
	);

	const handlePreviousYear = useCallback(() => {
		setPopoverYear((prev) => prev - 1);
	}, []);

	const handleNextYear = useCallback(() => {
		setPopoverYear((prev) => prev + 1);
	}, []);

	const isMonthDisabled = useCallback(
		(monthIndex: number) => {
			const testDate = new Date(popoverYear, monthIndex, 1);
			if (testDate > effectiveMaxDate) return true;
			if (minDate && testDate < minDate) return true;
			return false;
		},
		[popoverYear, effectiveMaxDate, minDate],
	);

	const isMonthSelected = useCallback(
		(monthIndex: number) => {
			if (!value) return false;
			return (
				value.getFullYear() === popoverYear && value.getMonth() === monthIndex
			);
		},
		[value, popoverYear],
	);

	// Sync popover year when the value changes externally
	const handleOpenChange = useCallback(
		(isOpen: boolean) => {
			if (isOpen && value) {
				setPopoverYear(value.getFullYear());
			}
			setOpen(isOpen);
		},
		[value],
	);

	const popoverContent = (
		<PopoverContent
			align={compact ? "start" : "center"}
			className="w-64 p-2"
		>
			{/* Year navigation */}
			<div className="mb-2 flex items-center justify-between">
				<Button
					aria-label="Previous year"
					disabled={minDate && popoverYear <= minDate.getFullYear()}
					onClick={handlePreviousYear}
					size="icon-sm"
					variant="ghost"
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="font-medium text-sm tabular-nums">
					{popoverYear}
				</span>
				<Button
					aria-label="Next year"
					disabled={popoverYear >= effectiveMaxDate.getFullYear()}
					onClick={handleNextYear}
					size="icon-sm"
					variant="ghost"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>

			{/* Month grid */}
			<div className="grid grid-cols-4 gap-1">
				{MONTHS.map((month, index) => (
					<Button
						className={cn(
							"h-8 text-xs",
							isMonthSelected(index) && "font-semibold",
						)}
						disabled={isMonthDisabled(index)}
						key={month}
						onClick={() => handleMonthSelect(index)}
						size="sm"
						variant={isMonthSelected(index) ? "default" : "ghost"}
					>
						{month}
					</Button>
				))}
			</div>
		</PopoverContent>
	);

	if (compact) {
		return (
			<Popover onOpenChange={handleOpenChange} open={open}>
				<PopoverTrigger asChild>
					<button
						className={cn(
							"flex h-7 cursor-pointer items-center rounded-md border border-input bg-transparent px-3 text-xs shadow-xs outline-none transition-[color,box-shadow] dark:bg-input/30",
							"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
							!value && "text-muted-foreground",
							className,
						)}
						type="button"
					>
						{value ? format(value, "MMM yyyy") : placeholder}
					</button>
				</PopoverTrigger>
				{popoverContent}
			</Popover>
		);
	}

	return (
		<div className={cn("flex items-center gap-1", className)}>
			<Button
				aria-label="Previous month"
				disabled={!canGoBackward}
				onClick={handlePrevious}
				size="icon-sm"
				variant="ghost"
			>
				<ChevronLeft className="h-4 w-4" />
			</Button>

			<Popover onOpenChange={handleOpenChange} open={open}>
				<PopoverTrigger asChild>
					<Button
						className="min-w-[100px] text-sm tabular-nums tracking-wide"
						variant="ghost"
					>
						{value ? format(value, "MMM yyyy") : placeholder}
					</Button>
				</PopoverTrigger>
				{popoverContent}
			</Popover>

			<Button
				aria-label="Next month"
				disabled={!canGoForward}
				onClick={handleNext}
				size="icon-sm"
				variant="ghost"
			>
				<ChevronRight className="h-4 w-4" />
			</Button>
		</div>
	);
}
