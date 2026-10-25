import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { runWebhookWorker } from "~/server/services/webhooks/worker";

/**
 * One webhook sweep (fan out new events, send what is due, prune), for a
 * scheduler to call every minute: the sidecar's cron, or any `curl`. The
 * app also sweeps after writes and at the next retry time on its own; this
 * is what picks deliveries back up after a restart. Authenticated with the
 * worker key, like the sidecar's own endpoints.
 */
export async function POST(request: NextRequest) {
	const key = env.WORKER_API_KEY;
	if (!key)
		return NextResponse.json({ error: "Not configured" }, { status: 503 });
	const given = Buffer.from(request.headers.get("authorization") ?? "");
	const expected = Buffer.from(`Bearer ${key}`);
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	return NextResponse.json(await runWebhookWorker());
}
