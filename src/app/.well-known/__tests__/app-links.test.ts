import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { ANDROID_APP_CERT_SHA256: undefined } }));

import { NextRequest } from "next/server";
import { env } from "~/env";
import { assetLinks, certFingerprints } from "~/lib/app-links";
import { proxy } from "~/proxy";
import { GET as getAasa } from "../apple-app-site-association/route";
import { GET as getAssetLinks } from "../assetlinks.json/route";

describe("apple-app-site-association", () => {
	it("serves the webcredentials app id as JSON", async () => {
		const res = getAasa();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(await res.json()).toEqual({
			webcredentials: { apps: ["6NHZWHQX37.app.retrospend"] },
		});
	});
});

describe("assetlinks.json", () => {
	it("is an empty list until a certificate fingerprint is set", async () => {
		const res = getAssetLinks();
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(await res.json()).toEqual([]);
	});

	it("grants get_login_creds to the app for each fingerprint", async () => {
		(env as { ANDROID_APP_CERT_SHA256?: string }).ANDROID_APP_CERT_SHA256 =
			"ab:cd:01, EF:23:45 ,";
		const body = await getAssetLinks().json();
		expect(body).toEqual([
			{
				relation: ["delegate_permission/common.get_login_creds"],
				target: {
					namespace: "android_app",
					package_name: "app.retrospend",
					sha256_cert_fingerprints: ["AB:CD:01", "EF:23:45"],
				},
			},
		]);
	});

	it("ignores blank settings", () => {
		expect(certFingerprints(" , ")).toEqual([]);
		expect(assetLinks("")).toEqual([]);
	});
});

describe("proxy", () => {
	it.each([
		"/.well-known/apple-app-site-association",
		"/.well-known/assetlinks.json",
	])("lets %s through without a session or a redirect", (path) => {
		const res = proxy(new NextRequest(`https://retrospend.app${path}`));
		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
	});
});
