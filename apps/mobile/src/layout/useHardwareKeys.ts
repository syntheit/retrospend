import { useEffect, useRef } from "react";
import { HardwareKeys, type KeyCommand } from "../../modules/hardware-keys";

/** The shortcuts (IMPLEMENTATION S5, iPad): Cmd+N adds, Cmd+F searches. */
export type KeyAction = "add" | "search";

const INPUTS: Record<KeyAction, string> = { add: "n", search: "f" };

export function commandsFor(titles: Record<KeyAction, string>): KeyCommand[] {
	return (Object.keys(INPUTS) as KeyAction[]).map((id) => ({
		id,
		input: INPUTS[id],
		title: titles[id],
	}));
}

/**
 * Registers the hardware keyboard shortcuts while the component is mounted.
 * The titles are what the system lists when Cmd is held. Without the native
 * module (Android, tests) nothing happens.
 */
export function useHardwareKeys(
	titles: Record<KeyAction, string>,
	handlers: Record<KeyAction, () => void>,
): void {
	// The latest handlers, without re-registering the commands on every render.
	const latest = useRef(handlers);
	latest.current = handlers;
	const { add, search } = titles;

	useEffect(() => {
		if (!HardwareKeys) return;
		HardwareKeys.setCommands(commandsFor({ add, search }));
		const subscription = HardwareKeys.addListener("onKeyCommand", (event) => {
			if (event.id === "add" || event.id === "search") {
				latest.current[event.id]();
			}
		});
		return () => subscription.remove();
	}, [add, search]);
}
