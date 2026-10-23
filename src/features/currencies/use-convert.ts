"use client";

import { useEffect, useState } from "react";
import { convertAmount } from "./server/convert-action";
import type { ConvertDirection, ConvertResult } from "./types";

/**
 * A conversion the server computes: the typed amount (minor units from the
 * shared parser) goes to the server function, a Money per rate type comes
 * back. Debounced so typing does not send a request per key; a stale answer
 * never replaces a newer one.
 */
export function useConvert(
	code: string | null,
	minor: number | null,
	direction: ConvertDirection,
) {
	const [result, setResult] = useState<ConvertResult | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (!code || minor == null) {
			setResult(null);
			return;
		}
		let live = true;
		const timer = setTimeout(() => {
			convertAmount(code, minor, direction)
				.then((r) => {
					if (!live) return;
					setResult(r);
					setFailed(false);
				})
				.catch(() => {
					if (live) setFailed(true);
				});
		}, 250);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [code, minor, direction]);
	return { result, failed };
}
