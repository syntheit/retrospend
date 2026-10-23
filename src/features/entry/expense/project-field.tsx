"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PickerPopover } from "~/components/pickers/picker-popover";
import {
	type PickerProject,
	ProjectPicker,
	ProjectThumb,
} from "~/components/pickers/project-picker";
import { FilterChip } from "~/components/ui/chip";
import type { Project } from "./expense-fields";

/** The sheet's projects as the picker shows them: cover, head count, currency. */
function pickerProjects(projects: readonly Project[]): PickerProject[] {
	return projects.map((p) => ({
		id: p.id,
		name: p.name,
		coverUrl: p.coverUrl,
		currency: p.primaryCurrency,
		peopleCount: p.peopleCount,
	}));
}

/**
 * Project: a value chip with the project's cover and name that opens the
 * ProjectPicker (R25: pickers carry identity).
 */
export function ProjectField({
	projects,
	value,
	onChange,
}: {
	projects: readonly Project[];
	value: string | null;
	onChange: (project: Project | null) => void;
}) {
	const t = useTranslations("entry.expense");
	const [open, setOpen] = useState(false);
	const picked = projects.find((p) => p.id === value) ?? null;
	const name = picked?.name ?? t("noProject");
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={t("project")}
			trigger={
				<FilterChip
					aria-label={t("projectAria", { project: name })}
					className="max-w-full self-start"
					lead={<ProjectThumb className="size-5" coverUrl={picked?.coverUrl} />}
					value
				>
					<span className="min-w-0 truncate">{name}</span>
				</FilterChip>
			}
		>
			<ProjectPicker
				onChange={(id) => {
					setOpen(false);
					onChange(projects.find((p) => p.id === id) ?? null);
				}}
				projects={pickerProjects(projects)}
				value={value}
			/>
		</PickerPopover>
	);
}
