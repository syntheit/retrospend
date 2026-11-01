"use client";

import { ProjectThumb } from "~/components/pickers/project-picker";
import { type FacePerson, FaceStack } from "~/components/ui/avatar-face";
import { cn } from "~/lib/utils";

/**
 * ProjectChoice (provisional, composer design D): a project as a row with its
 * cover, name (one line), a small face stack and a meta line ("4 people ·
 * USD"). Selected is the brand border plus the brand soft fill.
 */
export function ProjectChoice({
	name,
	meta,
	coverUrl,
	members = [],
	selected,
	onSelect,
	label,
}: {
	name: string;
	meta?: string;
	coverUrl?: string | null;
	members?: FacePerson[];
	selected: boolean;
	onSelect: () => void;
	label?: string;
}) {
	return (
		<li>
			<button
				aria-label={label}
				aria-pressed={selected}
				className={cn(
					"rounded-ctl focus-visible:outline-brand flex min-h-11 w-full cursor-pointer items-center gap-3 border px-3 py-2 text-left transition-colors duration-(--t-state) focus-visible:outline-2 focus-visible:outline-offset-2",
					selected
						? "border-brand bg-brand-soft"
						: "border-line-strong bg-surface can-hover:hover:bg-raised",
				)}
				onClick={onSelect}
				type="button"
			>
				<ProjectThumb className="size-10" coverUrl={coverUrl} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-body text-fg truncate">{name}</span>
					{meta ? <span className="text-meta text-fg-3">{meta}</span> : null}
				</span>
				{members.length > 0 ? (
					<FaceStack max={3} on="surface" people={members} size="xs" />
				) : null}
			</button>
		</li>
	);
}
