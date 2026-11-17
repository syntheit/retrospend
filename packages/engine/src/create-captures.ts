/**
 * The creates the server accepted and the device has not compared yet (see
 * write-parity.ts), held in memory only: capped by count, dropped after a
 * time, and never given a title, location or note. The platform adds one
 * after a send succeeds, behind the dev flag; the device engine reads them
 * after a pull and drops each once compared.
 */
import type { SettingsRow } from "./port";
import {
	type CaptureBody,
	type CaptureKind,
	type CreateCapture,
	rateDefaultsKey,
} from "./write-parity";

export const MAX_CAPTURES = 50;
export const CAPTURE_TTL_MS = 10 * 60_000;

/** What a platform hands over after a send: the id, the kind and the request body as sent. */
export interface SentCreate {
	id: string;
	kind: CaptureKind;
	/** The whole body; only the fields that decide the booking are kept. */
	body: unknown;
	/** Epoch ms when the send began. */
	at: number;
}

const text = (v: unknown): string | undefined =>
	typeof v === "string" ? v : undefined;

/** The booking fields of a body as sent, or null when it lacks the ones a booking needs. */
function bodyOf(raw: unknown): CaptureBody | null {
	const b = (raw ?? {}) as Record<string, unknown>;
	const amount = text(b.amount);
	const currency = text(b.currency);
	const date = text(b.date);
	if (amount === undefined || currency === undefined || date === undefined)
		return null;
	const categoryId = text(b.categoryId);
	const rateType = text(b.rateType);
	const customRate = text(b.customRate);
	return {
		amount,
		currency,
		date,
		...(categoryId ? { categoryId } : {}),
		...(rateType ? { rateType } : {}),
		...(customRate ? { customRate } : {}),
		...(typeof b.excludeFromAnalytics === "boolean"
			? { excludeFromAnalytics: b.excludeFromAnalytics }
			: {}),
		...(typeof b.amortizeOver === "number"
			? { amortizeOver: b.amortizeOver }
			: {}),
	};
}

export class CreateCaptures {
	private readonly held = new Map<string, CreateCapture>();
	private settingsOf: (() => SettingsRow | undefined) | null = null;

	/** The engine says where the live settings are; a capture without them cannot be made. */
	bind(settings: () => SettingsRow | undefined): void {
		this.settingsOf = settings;
	}

	/** Holds a create, with the zone and rate types the device held when it was sent. False when it cannot. */
	add(sent: SentCreate): boolean {
		const settings = this.settingsOf?.();
		if (!settings) return false;
		const body = sent.kind === "expense" ? bodyOf(sent.body) : undefined;
		if (body === null) return false;
		this.held.delete(sent.id);
		this.held.set(sent.id, {
			id: sent.id,
			kind: sent.kind,
			...(body ? { body } : {}),
			zone: settings.timeZone,
			rateDefaults: rateDefaultsKey(settings),
			at: sent.at,
		});
		// Oldest first: a Map iterates in insertion order.
		while (this.held.size > MAX_CAPTURES) {
			const oldest = this.held.keys().next().value;
			if (oldest === undefined) break;
			this.held.delete(oldest);
		}
		return true;
	}

	/** Drops what is older than the time limit and returns how many. */
	prune(now: number): number {
		let dropped = 0;
		for (const [id, c] of this.held)
			if (now - c.at > CAPTURE_TTL_MS) {
				this.held.delete(id);
				dropped += 1;
			}
		return dropped;
	}

	pending(): CreateCapture[] {
		return [...this.held.values()];
	}

	drop(id: string): void {
		this.held.delete(id);
	}
}
