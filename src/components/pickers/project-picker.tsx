"use client";

import { FolderIcon } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { type FacePerson, FaceStack } from "~/components/ui/avatar-face";
import { cn } from "~/lib/cn";
import { PickerGroup, PickerItem, PickerList } from "./picker-list";

export type PickerProject = {
	id: string;
	name: string;
	/** The cover photo's URL; without one the slot stays a flat tile (N41). */
	coverUrl?: string | null;
	currency: string;
	/** The other members, for their faces; empty for a solo project. */
	people: readonly FacePerson[];
};

export type ProjectPickerProps = {
	projects: readonly PickerProject[];
	value: string | null;
	onChange: (id: string | null) => void;
};

/** The cover in the 24px lead slot: the photo, else a flat tile with the folder glyph. */
export function ProjectThumb({
	coverUrl,
	className = "size-6",
}: {
	coverUrl?: string | null;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-raised text-fg-3",
				className,
			)}
		>
			{coverUrl ? (
				<Image
					alt=""
					className="size-full object-cover"
					height={24}
					src={coverUrl}
					unoptimized
					width={24}
				/>
			) : (
				<FolderIcon className="size-3.5" strokeWidth={1.75} />
			)}
		</span>
	);
}

/**
 * ProjectPicker: None, then every project with its cover, its name, the
 * members' faces (or Solo) and its currency, on one line. Put it in a
 * PickerPopover; it is the content, not the trigger.
 */
export function ProjectPicker({
	projects,
	value,
	onChange,
}: ProjectPickerProps) {
	const t = useTranslations("pickers.project");
	return (
		<PickerList empty={t("empty")} label={t("label")} placeholder={t("find")}>
			<PickerGroup heading={t("label")}>
				<PickerItem
					keywords={[t("none")]}
					lead={<ProjectThumb />}
					onSelect={() => onChange(null)}
					selected={value === null}
					selectedLabel={t("selected")}
					value="__none"
				>
					{t("none")}
				</PickerItem>
				{projects.map((p) => (
					<PickerItem
						key={p.id}
						keywords={[p.name]}
						lead={<ProjectThumb coverUrl={p.coverUrl} />}
						onSelect={() => onChange(p.id)}
						selected={p.id === value}
						selectedLabel={t("selected")}
						value={p.id}
					>
						<span className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate">{p.name}</span>
							{p.people.length > 0 ? (
								<FaceStack on="surface" people={[...p.people]} size="xs" />
							) : (
								<span className="text-fg-3 text-meta">{t("solo")}</span>
							)}
							<span className="text-fg-3 text-meta">{p.currency}</span>
						</span>
					</PickerItem>
				))}
			</PickerGroup>
		</PickerList>
	);
}
