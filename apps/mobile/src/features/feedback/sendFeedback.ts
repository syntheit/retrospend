import type { RetrospendClient } from "@retrospend/api-client";
import type { SubmitFeedback } from "@retrospend/api-contract";
import { newClientId } from "@/data/ids";

export type SendResult =
	| { status: "sent" }
	/** The note arrived; the picture did not. Sending again would duplicate it. */
	| { status: "sentWithoutScreenshot" }
	| { status: "limit" }
	| { status: "failed" };

/**
 * Sends the note, then the screenshot if there is one. The note is the
 * point, so a picture that fails to upload does not undo it. The server
 * allows 5 a hour and answers 409 after that.
 */
export async function sendFeedback(
	api: Pick<RetrospendClient, "feedback">,
	body: SubmitFeedback,
	screenshot: File | null,
): Promise<SendResult> {
	let id: string;
	try {
		({ id } = await api.feedback.submit(body, {
			context: { idempotencyKey: newClientId() },
		}));
	} catch (error) {
		return (error as { status?: number } | null)?.status === 409
			? { status: "limit" }
			: { status: "failed" };
	}
	if (!screenshot) return { status: "sent" };
	try {
		await api.feedback.attachScreenshot(
			{ id, file: screenshot },
			{ context: { idempotencyKey: newClientId() } },
		);
		return { status: "sent" };
	} catch {
		return { status: "sentWithoutScreenshot" };
	}
}
