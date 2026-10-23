"use server";

import { headers } from "next/headers";
import { getWebSession } from "~/server/better-auth/web-session";
import { api } from "~/trpc/server";
import type { ConvertDirection, ConvertResult } from "../types";
import { loadRates } from "./load";
import { convert } from "./view-model";

const CODE = /^[A-Z0-9]{2,10}$/;

/**
 * The converter's server function: the browser sends the typed amount (in
 * minor units, parsed by the shared parser) and gets a Money per rate type
 * back, so no conversion runs in the client (R9). Reachable by direct POST,
 * so it checks the session and its input itself.
 */
export async function convertAmount(
	code: string,
	minor: number,
	direction: ConvertDirection,
): Promise<ConvertResult> {
	const session = await getWebSession(await headers());
	if (!session?.user.isActive) throw new Error("Sign in to convert");
	if (
		!CODE.test(code) ||
		!Number.isSafeInteger(minor) ||
		minor < 0 ||
		(direction !== "toHome" && direction !== "fromHome")
	)
		return [];
	const settings = await api.settings.getGeneral();
	return convert(
		await loadRates(),
		settings.homeCurrency,
		code,
		minor,
		direction,
	);
}
