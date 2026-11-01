"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
	CategoryGlyph,
	CategoryPicker,
} from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { useCategoryName } from "~/hooks/use-category-name";
import { api } from "~/trpc/react";

/** The category button of the recurring form: the one picker in a popover or sheet. */
export function RecurringCategoryField({
	value,
	onChange,
}: {
	value: string;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("recurring");
	const [open, setOpen] = useState(false);
	const { displayName } = useCategoryName();
	const { data: catalog } = api.entry.catalog.useQuery(undefined, {
		staleTime: 60_000,
	});
	const categories = useMemo(
		() => (catalog?.categories ?? []).filter((c) => c.kind === "EXPENSE"),
		[catalog],
	);
	const category = catalog?.categories.find((c) => c.id === value);
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={t("fieldCategory")}
			trigger={
				<Button
					aria-haspopup="dialog"
					aria-label={t("fieldCategory")}
					className="w-full justify-between"
					kind="secondary"
				>
					{category ? (
						<span className="flex min-w-0 items-center gap-2">
							<CategoryGlyph category={category} />
							<span className="truncate">{displayName(category.name)}</span>
						</span>
					) : (
						<span className="truncate text-fg-3">
							{t("fieldCategoryPlaceholder")}
						</span>
					)}
					<ChevronDown aria-hidden="true" className="text-fg-3" />
				</Button>
			}
		>
			<CategoryPicker
				categories={categories}
				onChange={(id) => {
					setOpen(false);
					onChange(id);
				}}
				recentIds={catalog?.recentCategoryIds}
				value={value || null}
			/>
		</PickerPopover>
	);
}
