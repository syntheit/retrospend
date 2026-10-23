import { CircleCheck, CircleX } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/** A payment between you and someone; `waitsForMe`: they say they paid you and it is pending. */
export type PaymentTarget = ActionTarget & { waitsForMe: boolean };

const waits = (p: PaymentTarget) => p.waitsForMe;

export const PAYMENT_ACTIONS: readonly ActionDef<PaymentTarget>[] = [
	{ id: "confirm", icon: CircleCheck, group: 0, swipe: "lead", when: waits },
	{ id: "notReceived", icon: CircleX, group: 1, danger: true, when: waits },
];
