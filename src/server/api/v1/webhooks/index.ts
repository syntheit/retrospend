import * as webhooks from "~/server/services/webhooks/service";
import { WebhookTargetError } from "~/server/services/webhooks/ssrf";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

const w = v1.webhooks;

/** `serve`, plus a refused target answering validation_failed on the `url` field. */
function handle<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
	return serve(async (...args: A) => {
		try {
			return await fn(...args);
		} catch (error) {
			if (error instanceof WebhookTargetError)
				throw problem("validation_failed", error.message, {
					errors: [{ path: "url", message: error.message }],
				});
			throw error;
		}
	});
}

export const webhooksRouter = {
	list: w.list.handler(
		handle(({ context, input }) =>
			webhooks.listWebhookPage(signedIn(context), input),
		),
	),
	get: w.get.handler(
		handle(({ context, input }) =>
			webhooks.getWebhook(signedIn(context), input.id),
		),
	),
	create: w.create.handler(
		handle(({ context, input }) =>
			webhooks.createWebhook(signedIn(context), input),
		),
	),
	update: w.update.handler(
		handle(({ context, input }) =>
			webhooks.updateWebhook(signedIn(context), input),
		),
	),
	delete: w.delete.handler(
		handle(({ context, input }) =>
			webhooks.deleteWebhook(signedIn(context), input.id),
		),
	),
	rotateSecret: w.rotateSecret.handler(
		handle(({ context, input }) =>
			webhooks.rotateWebhookSecret(signedIn(context), input.id),
		),
	),
	test: w.test.handler(
		handle(({ context, input }) =>
			webhooks.testWebhook(signedIn(context), input.id),
		),
	),
	deliveries: w.deliveries.handler(
		handle(({ context, input }) =>
			webhooks.listDeliveryPage(signedIn(context), input.id, input),
		),
	),
};
