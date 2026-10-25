"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import { APP_VERSION } from "~/lib/version";
import { api } from "~/trpc/react";

const MAX_LENGTH = 5000;

interface FeedbackModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Send feedback to the admin: one sheet, one text box, one Send. */
export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
	const t = useTranslations("feedback");
	const toast = useToast();
	const [message, setMessage] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const pathname = usePathname();
	const submit = api.feedback.submit.useMutation();

	useEffect(() => {
		if (!open) return;
		setMessage("");
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, [open]);

	const handleSubmit = async () => {
		if (!message.trim()) return false;
		try {
			await submit.mutateAsync({
				message: message.trim(),
				pageUrl: pathname,
				userAgent:
					typeof navigator !== "undefined" ? navigator.userAgent : undefined,
				viewportSize:
					typeof window !== "undefined"
						? `${window.innerWidth}x${window.innerHeight}`
						: undefined,
				appVersion: APP_VERSION,
			});
		} catch (error) {
			toast.failed(error instanceof Error ? error.message : t("error"));
			return false;
		}
		toast.saved(t("success"));
		setMessage("");
	};

	return (
		<Sheet
			description={t("description")}
			onOpenChange={onOpenChange}
			onSubmit={handleSubmit}
			open={open}
			submitDisabled={!message.trim()}
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="relative">
				<Textarea
					className="min-h-30 resize-none"
					disabled={submit.isPending}
					maxLength={MAX_LENGTH}
					onChange={(e) => setMessage(e.target.value)}
					placeholder={t("placeholder")}
					ref={textareaRef}
					value={message}
				/>
				{message.length > 0 && (
					<span className="text-fg-3 text-meta absolute right-2 bottom-2 tabular-nums">
						{message.length} / {MAX_LENGTH}
					</span>
				)}
			</div>
		</Sheet>
	);
}
