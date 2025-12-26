import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
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
	const [copied, setCopied] = useState(false);

	const handleCopyPassword = async () => {
		if (!resetResult?.newPassword) return;

		try {
			await navigator.clipboard.writeText(resetResult.newPassword);
			setCopied(true);
			toast.success("Password copied to clipboard");
			setTimeout(() => setCopied(false), 2000);
		} catch (_error) {
			toast.error("Failed to copy password");
		}
	};
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{resetResult && (
					<div className="space-y-4">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: Label is descriptive for readonly password display */}
							<label className="font-medium text-sm">New Password</label>
							<div className="mt-1 flex gap-2">
								<Input
									className="font-mono"
									readOnly
									value={resetResult.newPassword}
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
								The user can now sign in with this password. Make sure to share
								it securely.
							</p>
						</div>
					</div>
				)}

				<DialogFooter>
					{resetResult ? (
						<Button onClick={onCancel}>Close</Button>
					) : (
						<>
							<Button disabled={isLoading} onClick={onCancel} variant="outline">
								Cancel
							</Button>
							<Button
								disabled={isLoading}
								onClick={onConfirm}
								variant={variant}
							>
								{isLoading ? "Processing..." : confirmLabel}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
