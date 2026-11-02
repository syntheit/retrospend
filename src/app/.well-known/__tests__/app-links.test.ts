import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { ANDROID_APP_CERT_SHA256: undefined } }));

import { NextRequest } from "next/server";
import { env } from "~/env";
import {
	APP_LINK_PATHS,
	assetLinks,
	certFingerprints,
	RELEASE_CERT_SHA256,
} from "~/lib/app-links";
import { proxy } from "~/proxy";
import { GET as getAasa } from "../apple-app-site-association/route";
import { GET as getAssetLinks } from "../assetlinks.json/route";

describe("apple-app-site-association", () => {
	it("serves universal links and the webcredentials app id as JSON", async () => {
		const res = getAasa();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		const body = await res.json();
		expect(body.webcredentials).toEqual({
			apps: ["6NHZWHQX37.app.retrospend"],
		});
		expect(body.applinks.details).toHaveLength(1);
		const [detail] = body.applinks.details;
		expect(detail.appIDs).toEqual(["6NHZWHQX37.app.retrospend"]);
		const paths = detail.components.map((c: { "/": string }) => c["/"]);
		for (const first of [
			"projects",
			"people",
			"entries",
			"notifications",
		]) {
			expect(paths).toContain(`/${first}`);
			expect(paths).toContain(`/${first}/*`);
		}
		// Pages the app has no screen for stay in the browser.
		expect(paths.join(" ")).not.toMatch(/login|signup|docs|api|admin/);
	});

	it("lists the same first segments as the app's router", () => {
		const source = readFileSync(
			join(process.cwd(), "apps/mobile/src/surfaces/links.ts"),
			"utf8",
		);
		const list = /WEB_LINK_PATHS = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
		const inApp = [...list.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
		expect(inApp).toEqual([...APP_LINK_PATHS]);
	});
});

describe("assetlinks.json", () => {
	it("serves the release key for app links and autofill without a setting", async () => {
		const res = getAssetLinks();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(await res.json()).toEqual([
			{
				relation: [
					"delegate_permission/common.get_login_creds",
					"delegate_permission/common.handle_all_urls",
				],
				target: {
					namespace: "android_app",
					package_name: "app.retrospend",
					sha256_cert_fingerprints: [RELEASE_CERT_SHA256],
				},
			},
		]);
		expect(RELEASE_CERT_SHA256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
	});

	it("adds the fingerprints from the setting, once each", async () => {
		(env as { ANDROID_APP_CERT_SHA256?: string }).ANDROID_APP_CERT_SHA256 =
			`ab:cd:01, EF:23:45 , ${RELEASE_CERT_SHA256.toLowerCase()},`;
		const body = await getAssetLinks().json();
		expect(body[0].target.sha256_cert_fingerprints).toEqual([
			RELEASE_CERT_SHA256,
			"AB:CD:01",
			"EF:23:45",
		]);
	});

	it("ignores blank settings", () => {
		expect(certFingerprints(" , ")).toEqual([]);
		expect(assetLinks("")[0]?.target.sha256_cert_fingerprints).toEqual([
			RELEASE_CERT_SHA256,
		]);
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
