import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enabledTransports, loadPushConfig } from "./config";
import { newApnsKey, newServiceAccount, newVapidEnv } from "./test-helpers";

const apnsKey = newApnsKey();
const APNS = {
	APNS_KEY_ID: "KEY1234567",
	APNS_TEAM_ID: "TEAM123456",
	APNS_BUNDLE_ID: "io.example.retrospend",
	APNS_KEY: apnsKey.pem,
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

describe("loadPushConfig", () => {
	it("has no sender when nothing is set, and says nothing", () => {
		const config = loadPushConfig({});
		expect(config.apns).toBeUndefined();
		expect(config.webPush).toBeUndefined();
		expect(config.fcm).toBeUndefined();
		expect(enabledTransports(config)).toEqual([]);
		expect(errors).not.toHaveBeenCalled();
	});

	it("turns each sender on from its own settings", () => {
		const config = loadPushConfig({
			...APNS,
			...newVapidEnv(),
			FCM_SERVICE_ACCOUNT: newServiceAccount().json,
		});
		expect(enabledTransports(config)).toEqual(["APNS", "FCM", "UNIFIEDPUSH"]);
		expect(loadPushConfig(APNS).webPush).toBeUndefined();
	});

	it("reads the .p8 key from one line with \\n or from a file", () => {
		const oneLine = apnsKey.pem.trim().replaceAll("\n", "\\n");
		expect(loadPushConfig({ ...APNS, APNS_KEY: oneLine }).apns).toBeDefined();

		const dir = mkdtempSync(join(tmpdir(), "push-config-"));
		const file = join(dir, "AuthKey.p8");
		writeFileSync(file, apnsKey.pem);
		const fromFile = loadPushConfig({
			...APNS,
			APNS_KEY: undefined,
			APNS_KEY_FILE: file,
		});
		expect(fromFile.apns?.keyId).toBe("KEY1234567");
	});

	it("turns a half-set or broken sender off, naming the setting but not its value", () => {
		const half = loadPushConfig({ APNS_KEY_ID: "KEY1234567" });
		expect(half.apns).toBeUndefined();

		const secret = "not-a-key-SECRETVALUE";
		const broken = loadPushConfig({ ...APNS, APNS_KEY: secret });
		expect(broken.apns).toBeUndefined();
		const logged = errors.mock.calls.flat().join("\n");
		expect(logged).toContain("APNS_KEY");
		expect(logged).not.toContain("SECRETVALUE");

		// One bad sender leaves the others alone.
		const mixed = loadPushConfig({
			...APNS,
			...newVapidEnv(),
			FCM_SERVICE_ACCOUNT: "{not json",
		});
		expect(enabledTransports(mixed)).toEqual(["APNS", "UNIFIEDPUSH"]);
	});

	it("rejects an APNs key that is not P-256", async () => {
		const { generateKeyPairSync } = await import("node:crypto");
		const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString();
		expect(loadPushConfig({ ...APNS, APNS_KEY: rsa }).apns).toBeUndefined();
	});

	it("checks the VAPID keys against each other and needs a contact", () => {
		const vapid = newVapidEnv();
		const other = newVapidEnv();
		expect(
			loadPushConfig({ ...vapid, VAPID_PUBLIC_KEY: other.VAPID_PUBLIC_KEY })
				.webPush,
		).toBeUndefined();
		// The public key can be left out: it is derived.
		const derived = loadPushConfig({
			VAPID_PRIVATE_KEY: vapid.VAPID_PRIVATE_KEY,
			VAPID_SUBJECT: vapid.VAPID_SUBJECT,
		});
		expect(derived.webPush?.publicKey).toBe(vapid.VAPID_PUBLIC_KEY);
		// A contact is required: given, or the https public URL.
		expect(
			loadPushConfig({ VAPID_PRIVATE_KEY: vapid.VAPID_PRIVATE_KEY }).webPush,
		).toBeUndefined();
		expect(
			loadPushConfig({
				VAPID_PRIVATE_KEY: vapid.VAPID_PRIVATE_KEY,
				PUBLIC_URL: "https://retro.example.test",
			}).webPush?.subject,
		).toBe("https://retro.example.test");
		expect(
			loadPushConfig({
				VAPID_PRIVATE_KEY: vapid.VAPID_PRIVATE_KEY,
				VAPID_SUBJECT: "ops@example.test",
			}).webPush,
		).toBeUndefined();
	});

	it("takes the project id from the service account unless one is set", () => {
		const account = newServiceAccount("from-file");
		expect(
			loadPushConfig({ FCM_SERVICE_ACCOUNT: account.json }).fcm?.projectId,
		).toBe("from-file");
		expect(
			loadPushConfig({
				FCM_SERVICE_ACCOUNT: account.json,
				FCM_PROJECT_ID: "override",
			}).fcm?.projectId,
		).toBe("override");
	});

	it("reads the operator's allow list", () => {
		expect(
			loadPushConfig({ PUSH_ENDPOINT_ALLOW_HOSTS: "ntfy.lan, 192.168.1.20" })
				.allowHosts,
		).toEqual(new Set(["ntfy.lan", "192.168.1.20"]));
	});
});
