import type { RetrospendClient } from "@retrospend/api-client";
import type { ReadCache } from "@/data/cache";
import { withTimeout } from "@/features/recurring/deviceSettle";
import { serverWealthWrites } from "@/lib/server-info";

// Whether this server takes the account and transfer writes a phone queues
// (features.wealthWrites). The answer is kept in the account's read cache, so
// a phone that is offline reads what the server said last; with neither, it
// is off and the write goes online as it always did (fail closed).

const NAME = "server.wealthWrites";
const SCHEMA = 1;

export async function wealthWritesOn(
	api: Pick<RetrospendClient, "platform">,
	cache: Pick<ReadCache, "read" | "write">,
): Promise<boolean> {
	try {
		const info = await withTimeout((options) =>
			api.platform.serverInfo(undefined, options),
		);
		const on = serverWealthWrites(info);
		await cache.write(NAME, SCHEMA, on).catch(() => undefined);
		return on;
	} catch {
		try {
			return (await cache.read<boolean>(NAME, SCHEMA))?.data === true;
		} catch {
			return false;
		}
	}
}
