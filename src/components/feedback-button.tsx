"use client";

import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { FeedbackModal } from "~/components/feedback-modal";
import { Button } from "~/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function FeedbackButton() {
	const [open, setOpen] = useState(false);
	const { data: session } = useSession();
	const { data: flags } = api.system.getFeatureFlags.useQuery();

	if (!flags?.feedbackEnabled) return null;
	if (!session?.user) return null;

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label="Send Feedback"
						className="relative h-8 w-8"
						onClick={() => setOpen(true)}
						size="icon"
						variant="ghost"
					>
						<MessageSquarePlus className="h-4 w-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Send Feedback</TooltipContent>
			</Tooltip>
			<FeedbackModal onOpenChange={setOpen} open={open} />
		</>
	);
}
