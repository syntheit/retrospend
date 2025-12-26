"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

function formatDate(date: Date | undefined) {
	if (!date) {
		return "";
	}

	return date.toLocaleDateString("en-US", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	});
}

function isValidDate(date: Date | undefined) {
	if (!date) {
		return false;
	}
	return !Number.isNaN(date.getTime());
}

interface DatePickerProps {
	date?: Date;
	onSelect?: (date: Date | undefined) => void;
	placeholder?: string;
	className?: string;
}

export function DatePicker({
	date,
	onSelect,
	placeholder = "Pick a date",
	className,
}: DatePickerProps) {
	const [open, setOpen] = React.useState(false);
	const [value, setValue] = React.useState(formatDate(date));
	const [month, setMonth] = React.useState<Date | undefined>(date);

	React.useEffect(() => {
		setValue(formatDate(date));
		setMonth(date);
	}, [date]);

	return (
		<div className={cn("relative flex gap-2", className)}>
			<Input
				className="bg-background pr-10"
				onChange={(e) => {
					const inputValue = e.target.value;
					setValue(inputValue);
					const parsedDate = new Date(inputValue);
					if (isValidDate(parsedDate)) {
						onSelect?.(parsedDate);
						setMonth(parsedDate);
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setOpen(true);
					}
				}}
				placeholder={placeholder}
				value={value}
			/>
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger asChild>
					<Button
						className="absolute top-1/2 right-2 size-6 -translate-y-1/2"
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
						mode="single"
						month={month}
						onMonthChange={setMonth}
						onSelect={(selectedDate) => {
							onSelect?.(selectedDate);
							setValue(formatDate(selectedDate));
							setOpen(false);
						}}
						selected={date}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
