"use client";

import { Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Sheet } from "~/components/ui/sheet";
import { categoryTone } from "~/lib/category-tone";
import { cn } from "~/lib/cn";
import { SelectField } from "../select-field";
import { CategoryEditor } from "./category-editor";
import {
	type CategoryManagerProps,
	useCategoryManager,
} from "./use-category-manager";

/**
 * The category manager (mockup): one wide sheet with the categories on the
 * left and the chosen one on the right: name, icon, color, Count in
 * spending and delete. Every change saves at once.
 */
export function CategoryManager(props: CategoryManagerProps) {
	const {
		t,
		selectedId,
		mobileView,
		setMobileView,
		saveStatus,
		categories,
		deleteMutation,
		selectedCategory,
		editName,
		editIcon,
		editColor,
		editExclude,
		nameInputRef,
		showDeleteConfirm,
		setShowDeleteConfirm,
		showReassignDialog,
		setShowReassignDialog,
		reassignExpenseCount,
		replacementCategoryId,
		setReplacementCategoryId,
		displayName,
		handleNameChange,
		handleIconChange,
		handleColorChange,
		handleExcludeChange,
		confirmDelete,
		handleReassignAndDelete,
		handleOpenChange,
		handleSelectCategory,
		displayColors,
	} = useCategoryManager(props);
	const { open } = props;

	const others = categories?.filter((c) => c.id !== selectedId) ?? [];

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
								confirmingDelete={showDeleteConfirm}
								deleting={deleteMutation.isPending}
								displayedName={displayName(selectedCategory.name)}
								exclude={editExclude}
								icon={editIcon}
								name={editName}
								nameRef={nameInputRef}
								onAskDelete={() => setShowDeleteConfirm(true)}
								onBack={() => setMobileView("list")}
								onCancelDelete={() => setShowDeleteConfirm(false)}
								onColor={handleColorChange}
								onConfirmDelete={confirmDelete}
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

			<Sheet
				description={t("reassignDescription", { count: reassignExpenseCount })}
				footer={
					<>
						<Button
							kind="secondary"
							onClick={() => setShowReassignDialog(false)}
						>
							{t("cancel")}
						</Button>
						<Button
							disabled={deleteMutation.isPending}
							kind="danger"
							loading={deleteMutation.isPending}
							onClick={handleReassignAndDelete}
						>
							{t("reassignAndDelete")}
						</Button>
					</>
				}
				onOpenChange={setShowReassignDialog}
				open={showReassignDialog}
				title={t("reassignExpenses")}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor="replacement-category">{t("reassignTo")}</Label>
					<SelectField
						id="replacement-category"
						onChange={setReplacementCategoryId}
						options={[
							{ value: "uncategorized", label: t("uncategorized") },
							...others.map((c) => ({
								value: c.id,
								label: displayName(c.name),
							})),
						]}
						value={replacementCategoryId}
					/>
				</div>
			</Sheet>
		</>
	);
}
