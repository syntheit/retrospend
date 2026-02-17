"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as LucideIcons from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { CATEGORY_COLORS, COLOR_TO_HEX } from "~/lib/constants";
import { cn } from "~/lib/utils";

// Common icons for the picker
const ICON_OPTIONS = [
	"Home",
	"Car",
	"Utensils",
	"ShoppingBag",
	"Zap",
	"Coffee",
	"Briefcase",
	"GraduationCap",
	"Heart",
	"Music",
	"Plane",
	"Gamepad2",
	"Shirt",
	"Dumbbell",
	"Dog",
	"Hammer",
	"Monitor",
	"Smartphone",
	"Wifi",
	"Gift",
	"CreditCard",
	"Banknote",
	"Bus",
	"Train",
	"Tag",
	"ShoppingBasket",
	"HeartPulse",
] as const;

export const categoryFormSchema = z.object({
	name: z.string().min(1, "Name is required").max(64, "Name is too long"),
	color: z.enum(CATEGORY_COLORS),
	icon: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "create" | "edit";
	defaultValues?: CategoryFormValues;
	onSubmit: (values: CategoryFormValues) => Promise<void>;
	isSubmitting: boolean;
	onDelete?: () => void | Promise<void>;
}

export function CategoryFormDialog({
	open,
	onOpenChange,
	mode,
	defaultValues,
	onSubmit,
	isSubmitting,
	onDelete,
}: CategoryFormDialogProps) {
	const form = useForm<CategoryFormValues>({
		resolver: zodResolver(categoryFormSchema),
		defaultValues: {
			name: "",
			color: "emerald",
			icon: "Tag",
		},
	});

	useEffect(() => {
		if (open) {
			if (defaultValues) {
				form.reset(defaultValues);
			} else {
				form.reset({
					name: "",
					color: "emerald",
					icon: "Tag",
				});
			}
		}
	}, [open, defaultValues, form]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "Add Category" : "Edit Category"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "Create a new category to organize your spending."
							: "Update your category details."}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form
						className="flex flex-1 flex-col gap-6 overflow-hidden"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						<ScrollArea className="-mr-4 flex-1 pr-4">
							<div className="space-y-6 pb-2">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Name</FormLabel>
											<FormControl>
												<Input placeholder="e.g. Groceries" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="icon"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Icon</FormLabel>
											<FormControl>
												<ScrollArea className="h-48 rounded-md border p-3">
													<div className="flex flex-wrap items-center justify-start gap-2">
														{ICON_OPTIONS.map((iconName) => {
															const Icons = LucideIcons as unknown as Record<
																string,
																LucideIcons.LucideIcon
															>;
															const IconComp =
																Icons[iconName] || LucideIcons.Circle;
															const isSelected = field.value === iconName;
															return (
																<button
																	className={cn(
																		"flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
																		isSelected
																			? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
																			: "border-border text-muted-foreground",
																	)}
																	key={iconName}
																	onClick={(e) => {
																		e.preventDefault();
																		field.onChange(iconName);
																	}}
																	type="button"
																>
																	<IconComp className="h-5 w-5" />
																</button>
															);
														})}
													</div>
												</ScrollArea>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="color"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Color</FormLabel>
											<FormControl>
												<div className="flex flex-wrap items-center justify-start gap-3">
													{CATEGORY_COLORS.map((color) => {
														const isSelected = field.value === color;
														const backgroundColor =
															COLOR_TO_HEX[
																color as keyof typeof COLOR_TO_HEX
															] || "#ccc";
														return (
															<button
																className={cn(
																	"relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full ring-offset-2 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
																	isSelected &&
																		"shadow-sm ring-2 ring-primary ring-offset-2 ring-offset-background",
																)}
																key={color}
																onClick={(e) => {
																	e.preventDefault();
																	field.onChange(color);
																}}
																style={{ backgroundColor }}
																title={color}
																type="button"
															>
																{isSelected && (
																	<LucideIcons.Check className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />
																)}
															</button>
														);
													})}
												</div>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</ScrollArea>

						<DialogFooter className="mt-auto flex-row items-center justify-between gap-4 border-t py-2 pt-4 sm:justify-between">
							<div>
								{mode === "edit" && onDelete && (
									<Button
										className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
										onClick={onDelete}
										type="button"
										variant="ghost"
									>
										Delete
									</Button>
								)}
							</div>
							<div className="flex gap-2">
								<Button
									onClick={() => onOpenChange(false)}
									type="button"
									variant="outline"
								>
									Cancel
								</Button>
								<Button disabled={isSubmitting} type="submit">
									{isSubmitting
										? "Saving..."
										: mode === "create"
											? "Create Category"
											: "Save Changes"}
								</Button>
							</div>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
