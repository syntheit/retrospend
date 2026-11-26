import type { RetrospendClient } from "@retrospend/api-client";
import { deviceEngineModule } from "@/data/deviceEngineModule";
import type { OpenDeps } from "@/data/engine-db/open";
import type { Outbox } from "@/data/outbox";
import { type PosterOutcome, type PosterWho, runPoster } from "./poster";

// One background run for one account. The task may wake in the app's own
// process, with the app's engine running over the account's file: it then
// posts through that engine, client and outbox and builds nothing. Only with
// no engine running does it build one of its own, and give it back when done.

export interface AccountPorts {
	makeClient(who: PosterWho): RetrospendClient;
	makeOutbox(who: PosterWho): Outbox;
	/** The engine's storage deps; the app's own unless a test passes others. */
	openDeps?: OpenDeps;
}

export async function postForAccount(
	who: PosterWho,
	ports: AccountPorts,
): Promise<PosterOutcome> {
	const module = deviceEngineModule();
	if (!module) return { status: "off" };
	const live = module.liveEngineOf(who.baseUrl, who.meId);
	if (live) {
		// Without its outbox the app's engine cannot see what the poster queues.
		if (!live.outbox) return { status: "off" };
		await live.engine.pullIfStale();
		return runPoster({ api: live.api, outbox: live.outbox });
	}
	const api = ports.makeClient(who);
	const outbox = ports.makeOutbox(who);
	const engine = module.engineFor(
		api,
		who.meId,
		who.baseUrl,
		ports.openDeps,
		outbox,
	);
	try {
		// Plan over rows the server has just confirmed, not a stale disk copy.
		await engine.pullIfStale();
		return await runPoster({ api, outbox });
	} finally {
		await module.releaseEngine(api).catch(() => undefined);
	}
}
