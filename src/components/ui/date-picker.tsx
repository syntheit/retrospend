"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

interface DatePickerProps {
	date?: Date;
	onSelect?: (date: Date | undefined) => void;
	placeholder?: string;
	className?: string;
	fromYear?: number;
	toYear?: number;
}

export function DatePicker({
	date,
	onSelect,
	placeholder = "Pick a date",
	className,
	fromYear = 1900,
	toYear = 2100,
}: DatePickerProps) {
	const [open, setOpen] = React.useState(false);
	const [monthView, setMonthView] = React.useState<Date | undefined>(date);
	const [activeSegment, setActiveSegment] = React.useState<
		"month" | "day" | "year" | null
	>(null);

	const focusableRef = React.useRef<HTMLDivElement>(null);

	// Ensure the calendar view follows the selected date
	React.useEffect(() => {
		if (date) setMonthView(date);
	}, [date]);

	const updateDate = (newDate: Date) => {
		onSelect?.(newDate);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!date) {
			if (e.key === "Enter" || e.key === " ") {
				onSelect?.(new Date());
				setActiveSegment("month");
			}
			return;
		}

		if (e.key === "ArrowRight") {
			e.preventDefault();
			if (activeSegment === null) setActiveSegment("month");
			else if (activeSegment === "month") setActiveSegment("day");
			else if (activeSegment === "day") setActiveSegment("year");
			else if (activeSegment === "year") setActiveSegment("month");
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			if (activeSegment === null) setActiveSegment("year");
			else if (activeSegment === "year") setActiveSegment("day");
			else if (activeSegment === "day") setActiveSegment("month");
			else if (activeSegment === "month") setActiveSegment("year");
		} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const increment = e.key === "ArrowUp" ? 1 : -1;
			const newDate = new Date(date);

			if (activeSegment === "month" || activeSegment === null) {
				const day = date.getDate();
				newDate.setDate(1);
				newDate.setMonth(date.getMonth() + increment);
				const maxDays = new Date(
					newDate.getFullYear(),
					newDate.getMonth() + 1,
					0,
				).getDate();
				newDate.setDate(Math.min(day, maxDays));
			} else if (activeSegment === "day") {
				newDate.setDate(date.getDate() + increment);
			} else if (activeSegment === "year") {
				const day = date.getDate();
				const month = date.getMonth();
				newDate.setFullYear(date.getFullYear() + increment);
				const maxDays = new Date(newDate.getFullYear(), month + 1, 0).getDate();
				newDate.setDate(Math.min(day, maxDays));
			}

			updateDate(newDate);
		} else if (e.key === "Escape") {
			setActiveSegment(null);
			focusableRef.current?.blur();
		}
	};

	const Segment = ({
		type,
		children,
	}: {
		type: "month" | "day" | "year";
		children: React.ReactNode;
	}) => (
		<button
			className={cn(
				"cursor-pointer select-none appearance-none rounded-[3px] border-none bg-transparent px-1.5 py-0.5 outline-none transition-colors duration-150",
				activeSegment === type
					? "bg-zinc-300 text-zinc-900 dark:bg-zinc-500 dark:text-zinc-50"
					: "text-foreground hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80",
			)}
			onClick={(e) => {
				e.stopPropagation();
				setActiveSegment(type);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					focusableRef.current?.focus();
				}
			}}
			onPointerDown={(e) => {
				e.preventDefault();
				focusableRef.current?.focus();
				setActiveSegment(type);
			}}
			tabIndex={-1}
			type="button"
		>
			{children}
		</button>
	);

	return (
		<div className={cn("relative flex w-full gap-2", className)}>
			<div
				aria-expanded={open}
				aria-label="Date Picker Input"
				className={cn(
					"flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30",
					"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
					!date && "text-muted-foreground",
				)}
				onBlur={(e) => {
					if (!focusableRef.current?.contains(e.relatedTarget as Node)) {
						setActiveSegment(null);
					}
				}}
				onFocus={() => {
					if (!activeSegment) setActiveSegment("month");
				}}
				onKeyDown={handleKeyDown}
				ref={focusableRef}
				role="combobox"
				tabIndex={0}
			>
				{date ? (
					<div className="flex select-none flex-row items-center whitespace-nowrap">
						<Segment type="month">{MONTHS[date.getMonth()]}</Segment>
						<span className="mr-1 text-muted-foreground"> </span>
						<Segment type="day">{date.getDate()}</Segment>
						<span className="mr-0.5 text-muted-foreground">,</span>
						<Segment type="year">{date.getFullYear()}</Segment>
					</div>
				) : (
					<span className="select-none">{placeholder}</span>
				)}
			</div>

			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger asChild>
					<Button
						className="absolute top-1/2 right-2 size-6 -translate-y-1/2"
						onClick={(e) => {
							e.stopPropagation();
							setOpen(!open);
						}}
						variant="ghost"
					>
						<CalendarIcon className="size-3.5" />
						<span className="sr-only">Select date</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					alignOffset={-8}
					className="w-auto overflow-hidden p-0"
					sideOffset={10}
				>
					<Calendar
						captionLayout="dropdown"
						fromYear={fromYear}
						mode="single"
						month={monthView}
						onMonthChange={setMonthView}
						onSelect={(selectedDate) => {
							if (selectedDate) {
								updateDate(selectedDate);
								setOpen(false);
							}
						}}
						selected={date}
						toYear={toYear}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
