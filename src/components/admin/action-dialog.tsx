import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { Input } from "~/components/ui/input";

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

	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent>
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				{resetResult && <PasswordReveal password={resetResult.newPassword} />}

				<ResponsiveDialogFooter>
					{resetResult ? (
						<Button onClick={onCancel}>{t("close")}</Button>
					) : (
						<>
							<Button disabled={isLoading} onClick={onCancel} variant="outline">
								{t("cancel")}
							</Button>
							<Button
								disabled={isLoading}
								onClick={onConfirm}
								variant={variant}
							>
								{isLoading ? t("processing") : confirmLabel}
							</Button>
						</>
					)}
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

function PasswordReveal({ password }: { password: string }) {
	const t = useTranslations("admin");
	const [copied, setCopied] = useState(false);

	const handleCopyPassword = async () => {
		try {
			await navigator.clipboard.writeText(password);
			setCopied(true);
			toast.success(t("passwordCopied"));
			setTimeout(() => setCopied(false), 2000);
		} catch (_error) {
			toast.error(t("passwordCopyFailed"));
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<label className="font-medium text-sm" htmlFor="new-password">
					{t("newPassword")}
				</label>
				<div className="mt-1 flex gap-2">
					<Input
						className="font-mono"
						id="new-password"
						readOnly
						value={password}
					/>
					<Button
						className="shrink-0"
						onClick={handleCopyPassword}
						size="icon"
						variant="outline"
					>
						{copied ? (
							<Check className="h-4 w-4 text-green-600" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</Button>
				</div>
				<p className="mt-2 text-muted-foreground text-sm">
					{t("passwordShareNote")}
				</p>
			</div>
		</div>
	);
}
