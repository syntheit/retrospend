import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type Tone = "info" | "attention" | "danger";

const TONE: Record<Tone, { fill: string; icon: string; Icon: typeof Info }> = {
	info: { fill: "bg-info-bg", icon: "text-info", Icon: Info },
	attention: {
		fill: "bg-attention-bg",
		icon: "text-attention-text",
		Icon: TriangleAlert,
	},
	danger: { fill: "bg-danger-bg", icon: "text-danger", Icon: CircleAlert },
};

/**
 * Notice: one line that needs the person, with at most one action, and at
 * most one per page. A tinted fill, no border, never an accent stripe (R31).
 * Danger is for errors only; anything that waits on the person and has a
 * place in Needs you goes there instead.
 */
export function Notice({
	tone = "info",
	children,
	action,
	className,
}: {
	tone?: Tone;
	/** The one line. */
	children: ReactNode;
	/** One Button (secondary, size sm). */
	action?: ReactNode;
	className?: string;
}) {
	const { fill, icon, Icon } = TONE[tone];
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-ctl p-3 text-body text-fg",
				fill,
				className,
			)}
			data-tone={tone}
			role={tone === "danger" ? "alert" : "status"}
		>
			<Icon aria-hidden="true" className={cn("size-4 shrink-0", icon)} />
			<span className="min-w-0 flex-1">{children}</span>
			{action}
		</div>
	);
}
