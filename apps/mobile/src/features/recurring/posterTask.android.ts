import { createRetrospendClient } from "@retrospend/api-client";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";
import { ME_CACHE } from "@/auth/restore";
import { createTokenStore } from "@/auth/token-store";
import { createReadCache } from "@/data/cache";
import { deviceFlagOn } from "@/data/deviceWrites";
import { newClientId } from "@/data/ids";
import { createOutbox } from "@/data/outbox";
import { createSqliteStore } from "@/data/sqlite-store";
import { createEnabledStore } from "@/push/enabled";
import { type PosterOutcome, type PosterWho, runPosterTask } from "./poster";
import { postForAccount } from "./posterAccount";

// Android without Google services: the same WorkManager path as the push poll
// (expo-background-task, AndroidX; no Play services) wakes the app about every
// 15 minutes, the minimum Android allows, and the task posts what is due. It
// runs only under the dev flag, only for the account that armed it, and only
// while the app is not on screen. Android may run it late when the phone is
// dozing: a late run posts every missed period (the cap is 31 per run).

export const POSTER_TASK = "retrospend.recurring.post";

const store = createSqliteStore();
const whoStore = createEnabledStore(store, "poster.enabled");

function postFor(who: PosterWho): Promise<PosterOutcome> {
	return postForAccount(who, {
		makeClient: () => {
			const tokens = createTokenStore(who.baseUrl);
			return createRetrospendClient({
				baseUrl: who.baseUrl,
				newIdempotencyKey: newClientId,
				authHeaders: async (): Promise<Record<string, string>> => {
					const token = await tokens.get();
					return token ? { authorization: `Bearer ${token}` } : {};
				},
			});
		},
		makeOutbox: () => createOutbox(store, `${who.baseUrl}|${who.meId}`),
	});
}

TaskManager.defineTask(POSTER_TASK, async () => {
	try {
		// A build without the flag may still hold a registration from one with it.
		if (!deviceFlagOn()) return BackgroundTask.BackgroundTaskResult.Success;
		const outcome = await runPosterTask({
			who: () => whoStore.get(),
			signedInAs: async (baseUrl) => {
				const me = await createReadCache(store, baseUrl).read<{ id: string }>(
					ME_CACHE.name,
					ME_CACHE.schema,
				);
				return me?.data.id ?? null;
			},
			forget: async () => {
				await whoStore.clear();
				await stopPosterTask().catch(() => undefined);
			},
			appActive: () => AppState.currentState === "active",
			run: postFor,
		});
		if (__DEV__) console.log(`recurring poster ${outcome.status}`);
		return BackgroundTask.BackgroundTaskResult.Success;
	} catch (error) {
		// Offline or the server is down: the next run tries again.
		console.warn("recurring poster failed", error);
		return BackgroundTask.BackgroundTaskResult.Failed;
	}
});

/** Arms the task for `who`. Only under the dev flag: a build without it registers nothing. */
export async function startPosterTask(who: PosterWho): Promise<void> {
	if (!deviceFlagOn()) return;
	await whoStore.set(who);
	if (await TaskManager.isTaskRegisteredAsync(POSTER_TASK)) return;
	await BackgroundTask.registerTaskAsync(POSTER_TASK, { minimumInterval: 15 });
}

export async function stopPosterTask(): Promise<void> {
	if (await TaskManager.isTaskRegisteredAsync(POSTER_TASK)) {
		await BackgroundTask.unregisterTaskAsync(POSTER_TASK);
	}
}
