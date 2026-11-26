import { describe, expect, it } from "vitest";
import { generateOpenApiDocument } from "../openapi";
import { serverInfoSchema } from "./index";

const BASE = {
	name: "Retrospend",
	version: "0.5.0",
	apiVersion: "v1",
	minClientVersion: "0.0.0",
	features: { advancedProtection: false, autoPost: true },
	auth: { methods: ["password"], signUp: "open" },
	push: { transports: [] },
};

describe("serverInfoSchema features.autoPost", () => {
	it("takes a boolean", () => {
		expect(serverInfoSchema.safeParse(BASE).success).toBe(true);
		expect(
			serverInfoSchema.safeParse({
				...BASE,
				features: { advancedProtection: false, autoPost: false },
			}).success,
		).toBe(true);
	});

	it("refuses a missing or non-boolean value", () => {
		expect(
			serverInfoSchema.safeParse({
				...BASE,
				features: { advancedProtection: false },
			}).success,
		).toBe(false);
		expect(
			serverInfoSchema.safeParse({
				...BASE,
				features: { advancedProtection: false, autoPost: "true" },
			}).success,
		).toBe(false);
	});

	it("is a required boolean in the OpenAPI document", async () => {
		type Schema = {
			properties: Record<string, { type?: string }>;
			required: string[];
		};
		const doc = (await generateOpenApiDocument()) as {
			paths: Record<
				string,
				{
					get: {
						responses: Record<
							string,
							{
								content: {
									"application/json": {
										schema: { properties: { features: Schema } };
									};
								};
							}
						>;
					};
				}
			>;
		};
		const features =
			doc.paths["/server-info"]?.get.responses["200"]?.content[
				"application/json"
			].schema.properties.features;
		expect(features?.properties.autoPost?.type).toBe("boolean");
		expect(features?.required).toContain("autoPost");
	});
});
