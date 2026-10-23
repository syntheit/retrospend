import { describe, expect, it } from "vitest";
import {
	isAllowedPushEndpoint,
	parseAllowHosts,
} from "~/server/services/push-endpoint";

describe("isAllowedPushEndpoint", () => {
	const none = parseAllowHosts(undefined);

	it("accepts a public host name", () => {
		expect(isAllowedPushEndpoint("https://ntfy.sh/upAbC?up=1", none)).toBe(
			true,
		);
		expect(isAllowedPushEndpoint("https://push.example.org:8443/x", none)).toBe(
			true,
		);
	});

	it.each([
		"https://127.0.0.1/up",
		"https://10.0.0.5/up",
		"https://192.168.1.20:8080/up",
		"https://169.254.169.254/latest",
		"https://8.8.8.8/up",
		// The URL parser turns these into 127.0.0.1.
		"https://2130706433/up",
		"https://0x7f.1/up",
		"https://[::1]/up",
		"https://[fe80::1]/up",
		"https://[::ffff:127.0.0.1]/up",
		"https://[2001:db8::1]:8443/up",
		"https://localhost/up",
		"https://LOCALHOST./up",
		"https://ntfy.localhost/up",
		"not a url",
	])("refuses %s", (endpoint) => {
		expect(isAllowedPushEndpoint(endpoint, none)).toBe(false);
	});

	it("lets the allowlist through, and only it", () => {
		const allow = parseAllowHosts(
			" ntfy.lan , 192.168.1.20,[fd00::5], Push.Home.Localhost ",
		);
		expect(isAllowedPushEndpoint("https://192.168.1.20:8080/up", allow)).toBe(
			true,
		);
		expect(isAllowedPushEndpoint("https://[fd00::5]/up", allow)).toBe(true);
		expect(isAllowedPushEndpoint("https://push.home.localhost/up", allow)).toBe(
			true,
		);
		expect(isAllowedPushEndpoint("https://192.168.1.21/up", allow)).toBe(false);
		expect(isAllowedPushEndpoint("https://localhost/up", allow)).toBe(false);
	});
});
