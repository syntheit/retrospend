"use client";

import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";

interface UnsavedChangesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDiscard: () => void;
	onStay: () => void;
	title?: string;
	description?: string;
}

export function UnsavedChangesDialog({
	open,
	onOpenChange,
	onDiscard,
	onStay,
	title,
	description,
}: UnsavedChangesDialogProps) {
	const t = useTranslations("ui");
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title ?? t("unsavedChanges")}</DialogTitle>
					<DialogDescription>{description ?? t("unsavedChangesDescription")}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-2 sm:flex-row">
					<Button onClick={onStay} variant="ghost">
						{t("stayOnPage")}
					</Button>
					<Button onClick={onDiscard} variant="destructive">
						{t("discardChanges")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
