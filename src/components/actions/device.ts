import { Unplug } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A device approved at /device; `id` is its session id. */
export type DeviceTarget = ActionTarget;

export const DEVICE_ACTIONS: readonly ActionDef<DeviceTarget>[] = [
	{ id: "disconnect", icon: Unplug, group: 0, danger: true },
];
