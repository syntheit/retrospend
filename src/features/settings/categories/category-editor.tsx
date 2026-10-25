"use client";

import { ArrowLeft, Check, Circle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, Ref } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Switch } from "~/components/ui/switch";
import { Tip } from "~/components/ui/tooltip";
import { CATEGORY_ICON_REGISTRY } from "~/lib/category-icons";
import { categoryTone } from "~/lib/category-tone";
import { cn } from "~/lib/cn";
import type { CategoryColor } from "~/lib/constants";

const ICON_OPTIONS = Object.keys(CATEGORY_ICON_REGISTRY);

/** The right pane of the category manager: one category's fields. */
export function CategoryEditor({
	name,
	onName,
	nameRef,
	icon,
	onIcon,
	color,
	colors,
	onColor,
	exclude,
	onExclude,
	canDelete,
	confirmingDelete,
	onAskDelete,
	onCancelDelete,
	onConfirmDelete,
	deleting,
	displayedName,
	onBack,
}: {
	name: string;
	onName: (value: string) => void;
	nameRef: Ref<HTMLInputElement>;
	icon: string;
	onIcon: (icon: string) => void;
	color: CategoryColor;
	colors: CategoryColor[];
	onColor: (color: CategoryColor) => void;
	exclude: boolean;
	onExclude: (value: boolean) => void;
	canDelete: boolean;
	confirmingDelete: boolean;
	onAskDelete: () => void;
	onCancelDelete: () => void;
	onConfirmDelete: () => void;
	deleting: boolean;
	/** The category's name as people see it, for the delete question. */
	displayedName: string;
	/** Phones: back to the list. */
	onBack: () => void;
}) {
	const t = useTranslations("settingsPage");
	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-4 py-3 md:pl-6">
				<div className="md:hidden">
					<Button kind="ghost" onClick={() => onBack()} size="sm" type="button">
						<ArrowLeft aria-hidden="true" />
						{t("back")}
					</Button>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="category-name">{t("nameLabel")}</Label>
					<Input
						id="category-name"
						maxLength={64}
						onChange={(e) => onName(e.target.value)}
						placeholder={t("categoryNamePlaceholder")}
						ref={nameRef}
						value={name}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label>{t("iconLabel")}</Label>
					<div className="flex flex-wrap items-center gap-2">
						{ICON_OPTIONS.map((iconName) => {
							const IconComp = CATEGORY_ICON_REGISTRY[iconName] || Circle;
							const selected = icon === iconName;
							return (
								<Button
									aria-label={iconName}
									aria-pressed={selected}
									className={cn(
										"max-md:size-11",
										selected && "border-brand bg-brand-soft text-fg",
									)}
									icon
									key={iconName}
									kind="secondary"
									onClick={() => onIcon(iconName)}
									type="button"
								>
									<IconComp />
								</Button>
							);
						})}
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<Label>{t("colorLabel")}</Label>
					<div className="flex flex-wrap items-center gap-2" role="group">
						{colors.map((c) => {
							const selected = color === c;
							return (
								<Tip content={c} key={c}>
									<Button
										aria-label={c}
										aria-pressed={selected}
										className={cn(
											"can-hover:hover:bg-(--c) can-hover:hover:text-white bg-(--c) text-white max-md:size-11",
											selected && "outline-fg outline-2 outline-offset-2",
										)}
										icon
										kind="ghost"
										onClick={() => onColor(c)}
										style={
											{
												"--c": `var(--category-${categoryTone(c)})`,
											} as CSSProperties
										}
										type="button"
									>
										{selected && (
											<Check aria-hidden="true" className="size-4" />
										)}
									</Button>
								</Tip>
							);
						})}
					</div>
				</div>

				<div className="flex items-center justify-between gap-3">
					<div>
						<Label htmlFor="category-exclude">{t("excludeByDefault")}</Label>
						<p className="text-fg-3 text-meta mt-1">
							{t("excludeByDefaultDescription")}
						</p>
					</div>
					<Switch
						checked={exclude}
						id="category-exclude"
						onCheckedChange={onExclude}
					/>
				</div>

				{canDelete && (
					<div className="border-line border-t pt-4">
						{!confirmingDelete ? (
							<Button
								kind="ghost"
								onClick={() => onAskDelete()}
								size="sm"
								type="button"
							>
								<Trash2 aria-hidden="true" />
								{t("deleteCategory")}
							</Button>
						) : (
							<div className="flex flex-col gap-3" role="alert">
								<p className="text-fg text-small">
									{t("deleteCategoryConfirm", {
										name: displayedName,
									})}
								</p>
								<div className="flex gap-2">
									<Button
										kind="secondary"
										onClick={() => onCancelDelete()}
										size="sm"
									>
										{t("cancel")}
									</Button>
									<Button
										disabled={deleting}
										kind="danger"
										loading={deleting}
										onClick={onConfirmDelete}
										size="sm"
									>
										{t("deleteButton")}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
