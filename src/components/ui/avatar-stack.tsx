"use client";

import { Fragment } from "react";
import { UserAvatar } from "~/components/ui/user-avatar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";

interface AvatarStackParticipant {
	name: string;
	avatarUrl: string | null;
	shareAmount: number;
}

interface AvatarStackProps {
	participants: AvatarStackParticipant[];
	formatCurrency: (amount: number, currency: string) => string;
	currency: string;
	maxVisible?: number;
}

export function AvatarStack({
	participants,
	formatCurrency,
	currency,
	maxVisible = 4,
}: AvatarStackProps) {
	if (participants.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}

	const visible = participants.slice(0, maxVisible);
	const overflow = participants.length - maxVisible;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex items-center">
					{visible.map((p, i) => (
						<div
							className={i > 0 ? "-ml-1.5" : undefined}
							key={`${p.name}-${i}`}
						>
							<UserAvatar
								avatarUrl={p.avatarUrl}
								className="h-6 w-6 ring-2 ring-background text-[9px]"
								name={p.name}
								size="xs"
							/>
						</div>
					))}
					{overflow > 0 && (
						<div className="-ml-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 font-medium text-[10px] text-muted-foreground ring-2 ring-background">
							+{overflow}
						</div>
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="p-0">
				<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2">
					{participants.map((p, i) => (
						<Fragment key={`${p.name}-${i}`}>
							<span className="text-xs">
								{p.name}
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
