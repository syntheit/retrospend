"use client";

import { AddPersonSheet } from "./sheets/add-person-sheet";
import { SettingsSheet } from "./sheets/settings-sheet";
import { SettleAllSheet } from "./sheets/settle-all-sheet";
import { ShareSheet } from "./sheets/share-sheet";
import type { PageView } from "./types";

export type SheetState = {
	kind: "settleAll" | "addPerson" | "settings" | "share";
} | null;

/** The one open sheet of the project page. */
export function ProjectSheets({
	view,
	sheet,
	onClose,
}: {
	view: PageView;
	sheet: SheetState;
	onClose: () => void;
}) {
	if (!sheet) return null;
	const props = {
		view,
		onOpenChange: (open: boolean) => {
			if (!open) onClose();
		},
	};
	switch (sheet.kind) {
		case "settleAll":
			return <SettleAllSheet {...props} />;
		case "addPerson":
			return <AddPersonSheet {...props} />;
		case "settings":
			return <SettingsSheet {...props} />;
		case "share":
			return <ShareSheet {...props} />;
	}
}
