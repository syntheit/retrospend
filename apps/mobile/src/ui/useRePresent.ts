import { useCallback, useEffect, useState } from "react";

/**
 * Showing a sheet again that the system dismissed while the app still meant it
 * to be up (a locked sheet). `again` is true for one render, which hands the
 * native sheet a "not presented" and then a "presented" in turn, so the system
 * presents it anew; call `represent` from the dismissal handler. The sheet's
 * own state (and the draft behind it) is never touched.
 */
export function useRePresent(): [boolean, () => void] {
	const [again, setAgain] = useState(false);
	useEffect(() => {
		if (again) setAgain(false);
	}, [again]);
	const represent = useCallback(() => setAgain(true), []);
	return [again, represent];
}
