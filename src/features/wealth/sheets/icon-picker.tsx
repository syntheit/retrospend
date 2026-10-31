"use client";

import { useTranslations } from "next-intl";
import {
	PickerGroup,
	PickerItem,
	PickerList,
} from "~/components/pickers/picker-list";
import { AccountMark } from "~/components/rows/account-mark";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { type AccountIcon, BRANDS, MONOGRAM_SLOTS } from "~/lib/account-icons";

/** What the picker hands back: a logo or color, or none (the default glyph). */
export type IconPick = { kind: "BRAND" | "MONOGRAM"; value: string } | null;

/**
 * The content of the icon picker: the letter on a color, a searchable list
 * of the bundled logos, and Upload image. It is the content, not the
 * trigger (put it in a PickerPopover). Chosen logos are drawn in their own
 * color; nothing here is fetched.
 */
export function IconPicker({
	name,
	value,
	onPick,
	onUpload,
}: {
	/** The account's name: the letter on a color is its first letter. */
	name: string;
	value: AccountIcon | null;
	onPick: (pick: IconPick) => void;
	onUpload: () => void;
}) {
	const t = useTranslations("wealthPage.sheets.icon");
	const chosen = (kind: AccountIcon["kind"], v: string) =>
		value?.kind === kind && value.value === v;
	return (
		<div className="flex flex-col gap-2">
			<div>
				<div className="text-fg-2 text-small px-2 py-1">{t("letters")}</div>
				<div className="flex flex-wrap gap-1 px-1">
					{MONOGRAM_SLOTS.map((slot) => (
						<Tip content={t(`colors.${slot}`)} key={slot}>
							<Button
								aria-label={t(`colors.${slot}`)}
								aria-pressed={chosen("MONOGRAM", slot)}
								className={
									chosen("MONOGRAM", slot) ? "bg-brand-soft" : undefined
								}
								icon
								kind="ghost"
								onClick={() => onPick({ kind: "MONOGRAM", value: slot })}
								size="sm"
							>
								<AccountMark
									icon={{ kind: "MONOGRAM", value: slot }}
									name={name}
									size="menu"
								/>
							</Button>
						</Tip>
					))}
				</div>
			</div>
			<PickerList empty={t("empty")} label={t("title")} placeholder={t("find")}>
				<PickerGroup heading={t("logos")}>
					<PickerItem
						keywords={[t("none")]}
						lead={null}
						onSelect={() => onPick(null)}
						selected={value === null}
						selectedLabel={t("selected")}
						value="none"
					>
						{t("none")}
					</PickerItem>
					{BRANDS.map((b) => (
						<PickerItem
							key={b.slug}
							keywords={[b.title, b.slug]}
							lead={
								<AccountMark
									icon={{ kind: "BRAND", value: b.slug }}
									name={b.title}
									size="menu"
								/>
							}
							onSelect={() => onPick({ kind: "BRAND", value: b.slug })}
							selected={chosen("BRAND", b.slug)}
							selectedLabel={t("selected")}
							value={b.slug}
						>
							{b.title}
						</PickerItem>
					))}
				</PickerGroup>
			</PickerList>
			<Button kind="secondary" onClick={onUpload}>
				{t("upload")}
			</Button>
		</div>
	);
}
