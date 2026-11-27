import type { WriteOp } from "@retrospend/engine/device";
import { withTimeout } from "@/features/recurring/deviceSettle";
import type { WealthDevice } from "./deviceWealth";

// The server's dry run of an account or transfer write, which the sheet
// shows, with the device's own preview held against it (nothing is shown from
// it and it never waits). Offline this throws, and the sheet lets Save queue
// without a dry run.

/** What the compare reads of a dry run (the contract's PreviewResult). */
interface Dry {
	readonly changes: readonly {
		readonly id: string;
		readonly currency: string;
		readonly delta: { readonly minor: number };
	}[];
	readonly unchanged: readonly { readonly id: string }[];
	readonly unavailable: readonly { readonly id: string }[];
}

/** Only the compare reads these ids: the booking is thrown away. */
export const PREVIEW_LEG_ID = "preview-leg";
export const PREVIEW_SWITCH_ID = "preview-switch";

export function previewWealth<P extends Dry>(
	device: WealthDevice,
	op: WriteOp,
	run: (options: { signal: AbortSignal }) => Promise<P>,
): Promise<P> {
	return withTimeout(async (options) => {
		const diff = await run(options);
		void device.writes.comparePreview(op, diff).catch(() => undefined);
		return diff;
	});
}
