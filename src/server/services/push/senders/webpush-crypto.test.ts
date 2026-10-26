import { describe, expect, it } from "vitest";
import { decryptWebPush, newSubscription } from "../test-helpers";
import {
	encryptWebPush,
	MAX_WEB_PUSH_PAYLOAD,
	WebPushKeyError,
} from "./webpush-crypto";

describe("encryptWebPush", () => {
	it("matches the example in RFC 8291 appendix A", () => {
		const body = encryptWebPush(
			Buffer.from("When I grow up, I want to be a watermelon"),
			{
				p256dh:
					"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
				auth: "BTBZMqHH6r4Tts7J_aSIgg",
			},
			{
				salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
				privateKey: Buffer.from(
					"yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
					"base64url",
				),
			},
		);
		expect(body.toString("base64url")).toBe(
			"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
		);
	});

	it("round-trips through the device's side", () => {
		const sub = newSubscription();
		const text = Buffer.from(JSON.stringify({ title: "Pago registrado" }));
		const body = encryptWebPush(text, sub);
		expect(decryptWebPush(body, sub).equals(text)).toBe(true);
		// A new salt and sender key every time.
		expect(encryptWebPush(text, sub).equals(body)).toBe(false);
	});

	it("is unreadable with another device's keys", () => {
		const body = encryptWebPush(Buffer.from("secret"), newSubscription());
		expect(() => decryptWebPush(body, newSubscription())).toThrow();
	});

	it("refuses a payload that does not fit one record", () => {
		const sub = newSubscription();
		expect(() =>
			encryptWebPush(Buffer.alloc(MAX_WEB_PUSH_PAYLOAD), sub),
		).not.toThrow();
		expect(() =>
			encryptWebPush(Buffer.alloc(MAX_WEB_PUSH_PAYLOAD + 1), sub),
		).toThrow(RangeError);
	});

	it("refuses malformed subscription keys", () => {
		const sub = newSubscription();
		const payload = Buffer.from("x");
		expect(() => encryptWebPush(payload, { ...sub, auth: "AAAA" })).toThrow(
			WebPushKeyError,
		);
		expect(() =>
			encryptWebPush(payload, { ...sub, p256dh: "AAAAAAAAAAAAAAAAAAAAAA" }),
		).toThrow(WebPushKeyError);
		// 65 bytes that start right but are not a point on the curve.
		const offCurve = Buffer.alloc(65, 1);
		offCurve[0] = 4;
		expect(() =>
			encryptWebPush(payload, {
				...sub,
				p256dh: offCurve.toString("base64url"),
			}),
		).toThrow(WebPushKeyError);
	});
});
