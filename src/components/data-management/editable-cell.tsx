"use client";

import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CategoryPicker } from "~/components/category-picker";
import { CategoryBadge } from "~/components/ui/category-badge";
import { DatePicker } from "~/components/ui/date-picker";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

interface EditableCellProps {
	value: string | number | Date | null;
	type: "text" | "number" | "date" | "select" | "category";
	options?: { label: string; value: string }[];
	categories?: Array<{ id: string; name: string; color: string }>;
	onSave: (newValue: string | number | Date) => void;
	className?: string;
	placeholder?: string;
	formatDisplay?: (value: string | number | Date | null) => string;
}

export function EditableCell({
	value,
	type,
	options,
	categories,
	onSave,
	className,
	placeholder = "—",
	formatDisplay,
}: EditableCellProps) {
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const displayValue = formatDisplay
		? formatDisplay(value)
		: value instanceof Date
			? format(value, "MMM dd, yyyy")
			: type === "select" && options
				? (options.find((o) => o.value === value)?.label ??
					(value ? String(value) : ""))
				: type === "category" && categories
					? (categories.find((c) => c.id === value)?.name ??
						(value ? String(value) : ""))
					: value != null
						? String(value)
						: "";

	const startEditing = useCallback(() => {
		if (type === "select" || type === "date" || type === "category") {
			// these open their own UI directly
			setEditing(true);
			return;
		}
		setEditValue(value != null ? String(value) : "");
		setEditing(true);
	}, [type, value]);

	useEffect(() => {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	const handleSave = useCallback(() => {
		setEditing(false);
		const trimmed = editValue.trim();
		if (trimmed === "" && value == null) return;
		if (trimmed === String(value)) return;

		if (type === "number") {
			const num = Number(trimmed);
			if (!Number.isNaN(num)) onSave(num);
		} else {
			onSave(trimmed);
		}
	}, [editValue, value, type, onSave]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSave();
			} else if (e.key === "Escape") {
				e.preventDefault();
				setEditing(false);
			}
		},
		[handleSave],
	);

	if (editing) {
		if (type === "date") {
			return (
				<div className="w-48">
					<DatePicker
						date={value instanceof Date ? value : undefined}
						onSelect={(date) => {
							if (date) onSave(date);
							setEditing(false);
						}}
					/>
				</div>
			);
		}

		if (type === "select" && options) {
			return (
				<Select
					onValueChange={(val) => {
						onSave(val);
						setEditing(false);
					}}
					value={value != null ? String(value) : undefined}
				>
					<SelectTrigger className="h-8 w-full text-xs" size="sm">
						<SelectValue placeholder="Select..." />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__none__">
							<span className="text-muted-foreground">None</span>
						</SelectItem>
						{options.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		}

		if (type === "category") {
			return (
				<CategoryPicker
					categories={categories}
					className="h-8 w-full text-xs sm:w-full"
					onValueChange={(val) => {
						onSave(val);
						setEditing(false);
					}}
					value={value != null ? String(value) : undefined}
				/>
			);
		}

		return (
			<Input
				className="h-8 text-xs"
				onBlur={handleSave}
				onChange={(e) => setEditValue(e.target.value)}
				onKeyDown={handleKeyDown}
				ref={inputRef}
				type={type === "number" ? "number" : "text"}
				value={editValue}
			/>
		);
	}

	const matchedCategory =
		type === "category" && categories
			? categories.find((c) => c.id === value)
			: null;

	return (
		<button
			className={cn(
				"group/edit flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/50",
				className,
			)}
			onClick={startEditing}
			type="button"
		>
			{type === "category" && matchedCategory ? (
				<CategoryBadge
					className="h-5 text-[10px] sm:text-[10px]"
					color={matchedCategory.color}
					name={matchedCategory.name}
				/>
			) : (
				<span
					className={cn("truncate", !displayValue && "text-muted-foreground")}
				>
					{displayValue || placeholder}
				</span>
			)}
			<Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
		</button>
	);
}
