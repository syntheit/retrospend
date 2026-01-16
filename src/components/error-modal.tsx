"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";

interface ErrorModalProps {
	message: string;
	details?: string;
	isOpen: boolean;
	onClose: () => void;
}

export function ErrorModal({
	message,
	details,
	isOpen,
	onClose,
}: ErrorModalProps) {
	return (
		<AlertDialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Error Occurred</AlertDialogTitle>
					<AlertDialogDescription className="flex flex-col gap-2">
						<span className="font-medium text-foreground">{message}</span>
						{details && process.env.NODE_ENV === "development" && (
							<span className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
								{details}
							</span>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={onClose}>OK</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
