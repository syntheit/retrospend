"use client";

import { addMonths, format, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

interface MonthStepperProps {
	value: Date;
	onChange: (date: Date) => void;
	/** If true, disables navigation to future months */
	maxDate?: Date;
	/** If true, disables navigation to past months */
	minDate?: Date;
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
	maxDate,
	minDate,
	className,
}: MonthStepperProps) {
	const [open, setOpen] = useState(false);
	const [popoverYear, setPopoverYear] = useState(() => value.getFullYear());

	const now = useMemo(() => new Date(), []);
	const effectiveMaxDate = maxDate ?? now;

	const canGoForward = useMemo(() => {
		const nextMonth = addMonths(value, 1);
		return nextMonth <= effectiveMaxDate;
	}, [value, effectiveMaxDate]);

	const canGoBackward = useMemo(() => {
		if (!minDate) return true;
		const prevMonth = subMonths(value, 1);
		return prevMonth >= minDate;
	}, [value, minDate]);

	const handlePrevious = useCallback(() => {
		if (canGoBackward) {
			onChange(subMonths(value, 1));
		}
	}, [value, onChange, canGoBackward]);

	const handleNext = useCallback(() => {
		if (canGoForward) {
			onChange(addMonths(value, 1));
		}
	}, [value, onChange, canGoForward]);

	const handleMonthSelect = useCallback(
		(monthIndex: number) => {
			const newDate = new Date(popoverYear, monthIndex, 1);
			// Prevent selecting future months
			if (newDate > effectiveMaxDate) return;
			// Prevent selecting months before minDate
			if (minDate && newDate < minDate) return;
			onChange(newDate);
			setOpen(false);
		},
		[popoverYear, effectiveMaxDate, minDate, onChange],
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
			return (
				value.getFullYear() === popoverYear && value.getMonth() === monthIndex
			);
		},
		[value, popoverYear],
	);

	// Sync popover year when the value changes externally
	const handleOpenChange = useCallback(
		(isOpen: boolean) => {
			if (isOpen) {
				setPopoverYear(value.getFullYear());
			}
			setOpen(isOpen);
		},
		[value],
	);

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
						className="min-w-[100px] font-mono text-sm uppercase tracking-wide"
						variant="ghost"
					>
						{format(value, "MMM yyyy")}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="center" className="w-64 p-2">
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
						<span className="font-medium font-mono text-sm">{popoverYear}</span>
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
