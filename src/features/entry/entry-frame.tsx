"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useState,
} from "react";
import { Sheet } from "~/components/ui/sheet";
import type { SheetProps } from "~/components/ui/sheet-state";

type Publish = (props: SheetProps | null) => void;

const FrameContext = createContext<Publish | null>(null);

/**
 * The composer's one dialog (Expense, Income, Transfer). It mounts once and
 * stays still while the mode changes: the dialog, its overlay, the mode
 * switch and the footer are never unmounted, so nothing hides and shows, and
 * the mode switch's thumb can slide. Each mode hands its title, header,
 * fields, footer and submit to the frame through EntrySheet. The fields are
 * rendered here, inside the Sheet, so the pickers they open still count as
 * part of the dialog.
 */
export function EntryFrame({ children }: { children: ReactNode }) {
	const [props, publish] = useState<SheetProps | null>(null);
	return (
		<FrameContext value={publish}>
			{props ? <Sheet {...props} /> : null}
			{children}
		</FrameContext>
	);
}

/**
 * A mode's sheet. Inside the EntryFrame it hands its props to the frame (and
 * renders nothing itself); anywhere else it is a plain Sheet.
 */
export function EntrySheet(props: SheetProps) {
	const publish = useContext(FrameContext);
	// Every render, before paint: the frame shows what this mode says now.
	useLayoutEffect(() => {
		publish?.(props);
	});
	return publish ? null : <Sheet {...props} />;
}
