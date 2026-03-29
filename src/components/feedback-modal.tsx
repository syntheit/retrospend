"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Textarea } from "~/components/ui/textarea";
import { APP_VERSION } from "~/lib/version";
import { api } from "~/trpc/react";

const MAX_LENGTH = 5000;

interface FeedbackModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
	const [message, setMessage] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const pathname = usePathname();

	const submitMutation = api.feedback.submit.useMutation({
		onSuccess: () => {
			toast.success("Thanks for your feedback!");
			setMessage("");
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "Failed to submit feedback");
		},
	});

	useEffect(() => {
		if (open) {
			setMessage("");
			// Auto-focus textarea when modal opens
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
			});
		}
	}, [open]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			handleSubmit();
		}
	};

	const handleSubmit = () => {
		if (!message.trim()) return;

		submitMutation.mutate({
			message: message.trim(),
			pageUrl: pathname,
			userAgent:
				typeof navigator !== "undefined"
					? navigator.userAgent
					: undefined,
			viewportSize:
				typeof window !== "undefined"
					? `${window.innerWidth}x${window.innerHeight}`
					: undefined,
			appVersion: APP_VERSION,
		});
	};

	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent className="sm:max-w-md">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>Send Feedback</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						Share a bug report, feature request, or suggestion.
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>
				<div className="relative">
					<Textarea
						className="min-h-[120px] resize-none"
						disabled={submitMutation.isPending}
						maxLength={MAX_LENGTH}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="What's on your mind?"
						ref={textareaRef}
						value={message}
					/>
					{message.length > 0 && (
						<span className="absolute right-2 bottom-2 tabular-nums text-muted-foreground text-xs">
							{message.length} / {MAX_LENGTH}
						</span>
					)}
				</div>
				<ResponsiveDialogFooter>
					<Button
						disabled={submitMutation.isPending}
						onClick={() => onOpenChange(false)}
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={!message.trim() || submitMutation.isPending}
						onClick={handleSubmit}
					>
						{submitMutation.isPending
							? "Submitting..."
							: "Submit Feedback"}
					</Button>
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
