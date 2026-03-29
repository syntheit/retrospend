import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

function isEditableElement(el: HTMLElement): boolean {
	const tag = el.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

interface TableSearchProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	/** When true, pressing `/` (outside inputs) focuses this search */
	slashFocus?: boolean;
}

export function TableSearch({
	value,
	onChange,
	placeholder = "Search...",
	className,
	slashFocus = false,
}: TableSearchProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!slashFocus) return;
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== "/") return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const el = e.target as HTMLElement;
			if (isEditableElement(el)) return;
			if (document.activeElement === inputRef.current) return;
			e.preventDefault();
			// Defer focus so the browser doesn't insert `/` into the newly focused input
			setTimeout(() => inputRef.current?.focus(), 0);
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [slashFocus]);

	return (
		<div className={cn("relative w-full", className)}>
			<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				ref={inputRef}
				className="pr-9 pl-9"
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				value={value}
			/>
			{value && (
				<Button
					className="absolute top-1/2 right-3 h-auto w-auto -translate-y-1/2 p-0 text-muted-foreground hover:text-foreground"
					onClick={() => onChange("")}
					type="button"
					variant="ghost"
					size="icon"
				>
					<X className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}

interface ExpandableSearchProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	captureTyping?: boolean;
	/** When true, pressing `/` (outside inputs) expands and focuses this search */
	slashFocus?: boolean;
}

export function ExpandableSearch({
	value,
	onChange,
	placeholder = "Search...",
	className,
	captureTyping = false,
	slashFocus = false,
}: ExpandableSearchProps) {
	const [expanded, setExpanded] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Keep expanded if there's a value
	const isOpen = expanded || value.length > 0;

	const handleToggle = useCallback(() => {
		if (isOpen && !value) {
			setExpanded(false);
		} else if (!isOpen) {
			setExpanded(true);
		}
	}, [isOpen, value]);

	// Focus input when expanding
	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isOpen]);

	// Escape: clear value first, then collapse
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && isOpen) {
				if (value) {
					onChange("");
				} else {
					setExpanded(false);
				}
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, value, onChange]);

	// Slash focus: pressing `/` outside inputs expands and focuses
	useEffect(() => {
		if (!slashFocus) return;
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== "/") return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const el = e.target as HTMLElement;
			if (isEditableElement(el)) return;
			if (document.activeElement === inputRef.current) return;
			e.preventDefault();
			setExpanded(true);
			// Defer focus so the browser doesn't insert `/` into the newly focused input
			setTimeout(() => inputRef.current?.focus(), 0);
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [slashFocus]);

	// Auto-open and capture typing when user starts typing anywhere on the page
	useEffect(() => {
		if (!captureTyping) return;

		function handleKeyDown(e: KeyboardEvent) {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.key.length !== 1) return;
			// Skip `/` when slashFocus handles it (prevents typing `/` into search)
			if (slashFocus && e.key === "/") return;

			const target = e.target as HTMLElement;
			if (isEditableElement(target)) return;

			if (document.activeElement === inputRef.current) return;

			setExpanded(true);
			// Focus the input and let the browser naturally type the character
			inputRef.current?.focus();
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [captureTyping, slashFocus]);

	// Close on click outside (only if empty)
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				isOpen &&
				!value &&
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setExpanded(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen, value]);

	return (
		<div
			ref={containerRef}
			className={cn("relative flex items-center justify-end", className)}
		>
			{/* Expanding input container — grows leftward */}
			<div
				className={cn(
					"flex items-center overflow-hidden rounded-lg border transition-all duration-200 ease-in-out",
					isOpen
						? "w-36 sm:w-48 md:w-64 border-input bg-transparent shadow-xs"
						: "w-9 border-transparent",
				)}
			>
				<Button
					className={cn(
						"h-9 w-9 shrink-0",
						isOpen
							? "pointer-events-none text-foreground hover:bg-transparent"
							: "text-muted-foreground hover:text-foreground",
					)}
					onClick={handleToggle}
					type="button"
					variant="ghost"
					size="icon"
				>
					<Search className="h-4 w-4" />
				</Button>

				<input
					ref={inputRef}
					className={cn(
						"h-9 min-w-0 flex-1 bg-transparent pr-2 text-sm outline-none placeholder:text-muted-foreground",
						isOpen ? "opacity-100" : "pointer-events-none opacity-0",
					)}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					type="text"
					value={value}
				/>

				{isOpen && value && (
					<Button
						className="mr-2 h-auto w-auto shrink-0 p-0 text-muted-foreground hover:text-foreground"
						onClick={() => {
							onChange("");
							inputRef.current?.focus();
						}}
						type="button"
						variant="ghost"
						size="icon"
					>
						<X className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
