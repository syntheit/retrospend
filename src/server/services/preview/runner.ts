import {
	type PreviewRunner as CorePreviewRunner,
	type PreviewRunnerDeps as CorePreviewRunnerDeps,
	createPreviewRunnerCore,
} from "@retrospend/domain/figures/preview";
import { insidePreview } from "~/server/db-tx";
import type { UndoToken } from "./types";

export type PreviewRunnerDeps<Tx> = Omit<
	CorePreviewRunnerDeps<Tx, UndoToken>,
	"markPreview"
>;

export type PreviewRunner<Tx> = CorePreviewRunner<Tx, UndoToken>;

/**
 * The server's preview runner: the shared core with `insidePreview` always
 * passed, so every runner built here marks its transaction as a preview (the
 * seal path makes no key inside one). A lint rule bans importing the core
 * anywhere else under `src/`, so this cannot be bypassed by accident.
 */
export function createPreviewRunner<Tx>(
	deps: PreviewRunnerDeps<Tx>,
): PreviewRunner<Tx> {
	return createPreviewRunnerCore<Tx, UndoToken>({
		...deps,
		markPreview: insidePreview,
	});
}
