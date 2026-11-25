"use client";

import { categoryTone } from "@retrospend/domain/category-tone";
import { Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Sheet } from "~/components/ui/sheet";
import { cn } from "~/lib/cn";
import { CategoryEditor } from "./category-editor";
import { RemoveCategorySheet } from "./remove-category-sheet";
import {
	type CategoryManagerProps,
	useCategoryManager,
} from "./use-category-manager";

/**
 * The category manager (mockup): one wide sheet with the categories on the
 * left and the chosen one on the right: name, icon, color, Count in
 * spending and delete. Every change saves at once; delete opens its own
 * sheet, which shows what changes before Save.
 */
export function CategoryManager(props: CategoryManagerProps) {
	const {
		t,
		selectedId,
		mobileView,
		setMobileView,
		saveStatus,
		categories,
		selectedCategory,
		editName,
		editIcon,
		editColor,
		editExclude,
		nameInputRef,
		removing,
		setRemoving,
		displayName,
		handleNameChange,
		handleIconChange,
		handleColorChange,
		handleExcludeChange,
		handleRemoved,
		handleOpenChange,
		handleSelectCategory,
		displayColors,
	} = useCategoryManager(props);
	const { open } = props;

	return (
		<>
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={handleOpenChange}
				open={open}
				title={t("categoryManager")}
				wide
			>
				<div className="min-h-ctl mb-3 flex items-center gap-3">
					<span
						aria-live="polite"
						className="text-fg-3 text-small flex items-center gap-1"
					>
						{saveStatus === "saving" && t("saving")}
						{saveStatus === "saved" && (
							<>
								<Check aria-hidden="true" className="size-3" />
								{t("saved")}
							</>
						)}
					</span>
				</div>

				<div className="border-line flex h-120 min-h-0 border-t">
					<div
						className={cn(
							"border-line w-50 shrink-0 border-r max-md:w-full max-md:border-r-0",
							mobileView === "detail" && "max-md:hidden",
						)}
					>
						<ScrollArea className="h-full">
							<div className="flex flex-col py-1">
								{categories?.map((category) => (
									<Button
										className={cn(
											"h-auto w-full justify-start gap-3 rounded-none px-3 py-2",
											category.id === selectedId && "bg-raised text-fg",
										)}
										key={category.id}
										kind="ghost"
										onClick={() => handleSelectCategory(category.id)}
										type="button"
									>
										<CategoryTile
											category={{
												name: category.name,
												icon: category.icon,
												tone: categoryTone(category.color),
											}}
										/>
										<span className="text-body truncate">
											{displayName(category.name)}
										</span>
									</Button>
								))}
							</div>
						</ScrollArea>
					</div>

					<div
						className={cn(
							"min-w-0 flex-1",
							mobileView === "list" && "max-md:hidden",
						)}
					>
						{selectedCategory ? (
							<CategoryEditor
								canDelete={(categories?.length ?? 0) > 1}
								color={editColor}
								colors={displayColors}
								exclude={editExclude}
								icon={editIcon}
								name={editName}
								nameRef={nameInputRef}
								onBack={() => setMobileView("list")}
								onColor={handleColorChange}
								onDelete={() => setRemoving(true)}
								onExclude={handleExcludeChange}
								onIcon={handleIconChange}
								onName={handleNameChange}
							/>
						) : (
							<div className="flex h-full items-center justify-center p-6">
								<p className="text-fg-3 text-small">
									{t("selectCategoryPrompt")}
								</p>
							</div>
						)}
					</div>
				</div>
			</Sheet>

			<RemoveCategorySheet
				categories={categories ?? []}
				category={
					selectedCategory
						? {
								id: selectedCategory.id,
								name: displayName(selectedCategory.name),
							}
						: null
				}
				onOpenChange={setRemoving}
				onRemoved={handleRemoved}
				open={removing}
			/>
		</>
	);
}
