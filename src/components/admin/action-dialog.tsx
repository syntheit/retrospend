"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { Tip } from "~/components/ui/tooltip";

interface ActionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	variant?: "default" | "destructive";
	isLoading?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	resetResult?: {
		newPassword: string;
	};
}

/**
 * An admin action that needs a yes: a confirmation naming the person, and,
 * after a password reset, a sheet that shows the new password once.
 */
export function ActionDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	variant = "default",
	isLoading = false,
	onConfirm,
	onCancel,
	resetResult,
}: ActionDialogProps) {
	const t = useTranslations("admin");

	if (resetResult) {
		return (
			<Sheet
				description={description}
				footer={
					<Button kind="secondary" onClick={onCancel}>
						{t("close")}
					</Button>
				}
				onOpenChange={onOpenChange}
				open={open}
				title={title}
			>
				<PasswordReveal password={resetResult.newPassword} />
			</Sheet>
		);
	}

	return (
		<ConfirmationDialog
			confirmLabel={confirmLabel}
			description={description}
			isLoading={isLoading}
			onCancel={onCancel}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			title={title}
			variant={variant}
		/>
	);
}

function PasswordReveal({ password }: { password: string }) {
	const t = useTranslations("admin");
	const toast = useToast();
	const [copied, setCopied] = useState(false);

	const handleCopyPassword = async () => {
		try {
			await navigator.clipboard.writeText(password);
			setCopied(true);
			toast.saved(t("passwordCopied"));
			setTimeout(() => setCopied(false), 2000);
		} catch (_error) {
			toast.failed(t("passwordCopyFailed"));
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="new-password">{t("newPassword")}</Label>
			<div className="flex gap-2">
				<Input
					className="font-mono"
					id="new-password"
					readOnly
					value={password}
				/>
				<Tip content={t("copyPassword")}>
					<Button
						aria-label={t("copyPassword")}
						icon
						kind="secondary"
						onClick={handleCopyPassword}
					>
						{copied ? <Check /> : <Copy />}
					</Button>
				</Tip>
			</div>
			<p className="text-fg-3 text-small">{t("passwordShareNote")}</p>
		</div>
	);
}
