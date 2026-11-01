"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { AccountMark } from "~/components/rows/account-mark";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useToast } from "~/components/ui/toast";
import { type AccountIcon, brandBySlug } from "~/lib/account-icons";
import { type IconPick, IconPicker } from "./icon-picker";

/** The same cap and types as the profile picture (the route checks them again). */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** What the account sheet keeps while it is open and sends on Save. */
export type IconDraft = {
	/** What the row will show. A chosen file shows through a local preview URL. */
	icon: AccountIcon | null;
	/** A picture to upload after the account is saved. */
	file: File | null;
};

/**
 * The Icon field of Add and Edit account: a picker of the bundled logos, a
 * letter on a color, or the person's own picture. Nothing is saved until the
 * sheet's Save.
 */
export function IconField({
	name,
	value,
	onChange,
}: {
	name: string;
	value: IconDraft;
	onChange: (next: IconDraft) => void;
}) {
	const t = useTranslations("wealthPage.sheets.icon");
	const toast = useToast();
	const [open, setOpen] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const preview = useRef<string | null>(null);
	const { icon } = value;

	const release = () => {
		if (preview.current) URL.revokeObjectURL(preview.current);
		preview.current = null;
	};
	useEffect(() => release, []);

	const pick = (next: IconPick) => {
		release();
		onChange({ icon: next, file: null });
		setOpen(false);
	};

	const onFile = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		if (file.size > MAX_BYTES) {
			toast.failed(t("tooLarge"));
			return;
		}
		release();
		preview.current = URL.createObjectURL(file);
		onChange({ icon: { kind: "IMAGE", value: preview.current }, file });
		setOpen(false);
	};

	let label = t("default");
	if (icon?.kind === "BRAND") label = brandBySlug(icon.value)?.title ?? label;
	else if (icon?.kind === "MONOGRAM") label = t("letter");
	else if (icon?.kind === "IMAGE") label = t("image");

	return (
		<div className="flex flex-col gap-1">
			<Label id="acct-icon-label">{t("label")}</Label>
			<PickerPopover
				onOpenChange={setOpen}
				open={open}
				title={t("title")}
				trigger={
					<Button
						aria-labelledby="acct-icon-label acct-icon-value"
						className="w-full justify-start"
						kind="secondary"
					>
						{icon ? <AccountMark icon={icon} name={name} size="menu" /> : null}
						<span
							className="min-w-0 flex-1 truncate text-left"
							id="acct-icon-value"
						>
							{label}
						</span>
						<ChevronDown aria-hidden="true" className="text-fg-3" />
					</Button>
				}
			>
				<IconPicker
					name={name}
					onPick={pick}
					onUpload={() => fileRef.current?.click()}
					value={icon}
				/>
			</PickerPopover>
			<Input
				accept={ACCEPT}
				className="hidden"
				onChange={onFile}
				ref={fileRef}
				tabIndex={-1}
				type="file"
			/>
		</div>
	);
}
