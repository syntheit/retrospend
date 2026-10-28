import { createRetrospendClient } from "@retrospend/api-client";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { createTokenStore } from "@/auth/token-store";
import { createSqliteStore } from "@/data/sqlite-store";
import { createEnabledStore, pushScope } from "./enabled";
import { createFeedState, pollFeed } from "./feed";
import { local } from "./local";
import { runPoll } from "./runPoll";
import { channelDefs, makeTranslator, postFor } from "./texts";

// Android without Google services: WorkManager (through expo-background-task)
// wakes the app about every 15 minutes, the minimum Android allows, and the
// task polls the feeds and posts local notifications. Android may run it
// later when the phone is dozing; the cursor makes a late run catch up.

export const POLL_TASK = "retrospend.push.poll";

const store = createSqliteStore();
const enabledStore = createEnabledStore(store);

TaskManager.defineTask(POLL_TASK, async () => {
	try {
		const posted = await runPoll({
			enabled: () => enabledStore.get(),
			poll: (enabled) => {
				const tokens = createTokenStore(enabled.baseUrl);
				const api = createRetrospendClient({
					baseUrl: enabled.baseUrl,
					authHeaders: async (): Promise<Record<string, string>> => {
						const token = await tokens.get();
						return token ? { authorization: `Bearer ${token}` } : {};
					},
				});
				return pollFeed({
					api,
					state: createFeedState(store, pushScope(enabled)),
					meId: enabled.meId,
				});
			},
			local,
			translate: makeTranslator,
			channels: channelDefs,
			post: postFor,
		});
		if (__DEV__) console.log(`push poll posted ${posted}`);
		return BackgroundTask.BackgroundTaskResult.Success;
	} catch (error) {
		// Offline or the server is down: the next run tries again.
		console.warn("push poll failed", error);
		return BackgroundTask.BackgroundTaskResult.Failed;
	}
});

export async function startPolling(): Promise<void> {
	await BackgroundTask.registerTaskAsync(POLL_TASK, { minimumInterval: 15 });
}

export async function stopPolling(): Promise<void> {
	if (await TaskManager.isTaskRegisteredAsync(POLL_TASK)) {
		await BackgroundTask.unregisterTaskAsync(POLL_TASK);
	}
}

/** Runs the task now instead of waiting for WorkManager (debug builds, checks). */
export function pollNowForTesting(): Promise<boolean> {
	return BackgroundTask.triggerTaskWorkerForTestingAsync();
}
