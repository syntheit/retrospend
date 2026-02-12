import { toast } from "sonner";
import { ZodError } from "zod";

export function handleError(error: unknown, fallbackMessage = "Something went wrong") {
	console.error(error);

	if (error instanceof ZodError) {
		const message = error.issues[0]?.message ?? fallbackMessage;
		toast.error(message);
		return;
	}

	if (typeof error === "string") {
		toast.error(error);
		return;
	}

	if (error && typeof error === "object" && "message" in error) {
		// Handles Error objects and TRPCClientError (which has a message property)
		toast.error(String((error as Error).message));
		return;
	}

	toast.error(fallbackMessage);
}
