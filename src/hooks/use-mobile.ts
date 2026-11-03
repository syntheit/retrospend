import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/** True when any attached pointer is fine (mouse, trackpad); true until mounted. */
export function useHasFinePointer() {
	const [fine, setFine] = useState(true);

	useEffect(() => {
		const mql = window.matchMedia("(any-pointer: fine)");
		const onChange = () => setFine(mql.matches);
		mql.addEventListener("change", onChange);
		onChange();
		return () => mql.removeEventListener("change", onChange);
	}, []);

	return fine;
}

export function useIsMobile() {
	const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		const onChange = () => {
			setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
		};
		mql.addEventListener("change", onChange);
		setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	return !!isMobile;
}
