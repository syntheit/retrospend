import { useEffect } from "react";
import { getErrorLog } from "./runtime";

/** For an error boundary: keeps the error that stopped a screen from drawing. */
export function useRecordRenderError(error: unknown): void {
	useEffect(() => {
		void getErrorLog()
			.record("render", error)
			.catch(() => undefined);
	}, [error]);
}
