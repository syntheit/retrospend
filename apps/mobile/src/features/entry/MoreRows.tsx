import { useState } from "react";
import { useTranslations } from "use-intl";
import { TextField } from "@/ui/TextField";
import { ChangesBlock } from "./ChangesBlock";
import { OptionRow } from "./MorePanel";
import type { ComposerPreview } from "./useComposerPreview";

/**
 * Note as a row of More, for Income and Transfer: a pencil, the name and an
 * Add or Remove pill; turning it on opens the text field in place. A note
 * that is already there (undone changes, a share) shows open.
 */
export function NoteRow({
	value,
	onChange,
	onTypingChange,
	onPicked,
}: {
	value: string;
	onChange: (note: string) => void;
	onTypingChange: (typing: boolean) => void;
	onPicked: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const [asked, setAsked] = useState(false);
	const open = asked || value.length > 0;
	return (
		<OptionRow
			icon="Pencil"
			name={t("note")}
			on={open}
			onPress={() => {
				if (open) onChange("");
				setAsked(!open);
				onPicked();
			}}
			state={open ? t("extras.remove") : t("extras.add")}
		>
			{open ? (
				<TextField
					autoCapitalize="sentences"
					hideLabel
					label={t("note")}
					onChangeText={onChange}
					onTypingChange={onTypingChange}
					placeholder={t("notePlaceholder")}
					value={value}
				/>
			) : null}
		</OptionRow>
	);
}

/** What this changes, the full list the one-line preview summarizes. */
export function ChangesRow({ preview }: { preview: ComposerPreview }) {
	const t = useTranslations("mobile.composer");
	const [open, setOpen] = useState(false);
	// Nothing to show until the dry run has a reason or a figure to give.
	if (preview.preview.status === "idle") return null;
	return (
		<OptionRow
			icon="ListChecks"
			name={t("extras.changes")}
			on={open}
			onPress={() => setOpen(!open)}
			state={open ? t("extras.hide") : t("extras.show")}
		>
			{open ? (
				<ChangesBlock idle="" onRetry={preview.retry} state={preview.preview} />
			) : null}
		</OptionRow>
	);
}
