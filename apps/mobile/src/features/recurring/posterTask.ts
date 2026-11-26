// Not Android: iOS posts on app open only until the owner signs off a
// BGTaskScheduler identifier (a build config change, AGENTS 3). The real one
// is posterTask.android.ts.
import type { PosterWho } from "./poster";

export async function startPosterTask(_who: PosterWho): Promise<void> {}
export async function stopPosterTask(): Promise<void> {}
