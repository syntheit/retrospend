"use client";

import { Fragment } from "react";
import { Wallet } from "lucide-react";
import { UserAvatar } from "~/components/ui/user-avatar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

interface AvatarStackParticipant {
	participantType?: string;
	participantId?: string;
	name: string;
	avatarUrl: string | null;
	shareAmount: number;
}

interface AvatarStackProps {
	participants: AvatarStackParticipant[];
	formatCurrency: (amount: number, currency: string) => string;
	currency: string;
	maxVisible?: number;
	/**
	 * The participant who PAID. When it matches one of `participants` (by
	 * participantType + participantId), that person is moved to the FRONT of the
	 * stack, gets a subtle ring, and is labelled as the payer in the tooltip.
	 */
	payerRef?: { participantType: string; participantId: string } | null;
	/** Tooltip label appended to the payer, e.g. "Paid". */
	highlightTooltip?: string;
}

export function AvatarStack({
	participants,
	formatCurrency,
	currency,
	maxVisible = 4,
	payerRef,
	highlightTooltip,
}: AvatarStackProps) {
	if (participants.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}

	const isPayer = (p: AvatarStackParticipant) =>
		payerRef != null &&
		p.participantType === payerRef.participantType &&
		p.participantId === payerRef.participantId;

	// Surface the payer first so "who paid" reads at a glance. Stable otherwise.
	const ordered =
		payerRef != null
			? [...participants].sort((a, b) =>
					isPayer(a) === isPayer(b) ? 0 : isPayer(a) ? -1 : 1,
				)
			: participants;

	const visible = ordered.slice(0, maxVisible);
	const overflow = ordered.length - maxVisible;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex items-center">
					{visible.map((p, i) => {
						const payer = isPayer(p);
						return (
							<div
								className={i > 0 ? "-ml-1.5" : undefined}
								key={`${p.name}-${i}`}
							>
								<UserAvatar
									avatarUrl={p.avatarUrl}
									className={cn(
										"h-6 w-6 text-[9px] ring-2 ring-background",
										// Payer gets a coloured ring with a small offset so it
										// reads as distinct from the plain background ring.
										payer &&
											"ring-emerald-500 ring-offset-1 ring-offset-background dark:ring-emerald-400",
									)}
									name={p.name}
									size="xs"
								/>
							</div>
						);
					})}
					{overflow > 0 && (
						<div className="-ml-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 font-medium text-[10px] text-muted-foreground ring-2 ring-background">
							+{overflow}
						</div>
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="p-0">
				<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2">
					{ordered.map((p, i) => (
						<Fragment key={`${p.name}-${i}`}>
							<span className="flex items-center gap-1.5 text-xs">
								{p.name}
								{isPayer(p) && (
									<span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
										<Wallet className="h-3 w-3" />
										{highlightTooltip}
									</span>
								)}
							</span>
							<span className="text-right text-xs tabular-nums text-muted-foreground">
								{formatCurrency(p.shareAmount, currency)}
							</span>
						</Fragment>
					))}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
