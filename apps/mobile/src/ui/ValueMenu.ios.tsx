import type { ReactNode } from "react";
import type { MenuItem } from "./types";

/**
 * iOS keeps the system menu picker (and the wheel for a day of the month), so
 * a value row never opens this menu there; the value is drawn as it is.
 */
export function ValueMenu({
	children,
}: {
	items: MenuItem[];
	open: boolean;
	setOpen: (open: boolean) => void;
	children: ReactNode;
}) {
	return <>{children}</>;
}
