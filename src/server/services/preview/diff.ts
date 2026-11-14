// The diff is pure and shared with the device preview runner, so it lives in
// @retrospend/domain; this keeps the server's import path.
export {
	diffReadings,
	diffSnapshots,
	moneyDelta,
	type Snapshot,
} from "@retrospend/domain/figures/diff";
