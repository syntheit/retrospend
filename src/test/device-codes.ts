import { auth } from "~/server/better-auth";
import { adminDb } from "~/test/pg-harness";

const CLIENT = "retrospend-cli";

/**
 * A device code the way /device leaves it once someone signed in as `userId`
 * approved it: the poller holding the returned code can trade it for a session.
 */
export async function approvedDeviceCode(userId: string): Promise<string> {
	const made = await auth.api.deviceCode({ body: { client_id: CLIENT } });
	await adminDb.deviceCode.update({
		where: { deviceCode: made.device_code },
		data: { status: "approved", userId },
	});
	return made.device_code;
}

/** What polling /device/token with the code gives: a session, or a refusal. */
export async function pollDeviceCode(
	deviceCode: string,
): Promise<"session" | "refused"> {
	return auth.api
		.deviceToken({
			body: {
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: deviceCode,
				client_id: CLIENT,
			},
		})
		.then(
			() => "session" as const,
			() => "refused" as const,
		);
}

export const deviceCodeRows = (userId: string) =>
	adminDb.deviceCode.count({ where: { userId } });
