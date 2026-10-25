import * as z from "zod";
import { v1 } from "../common/meta";
import { scopeSchema } from "../common/scopes";

export const AUTH_METHODS = [
	"password",
	"totp",
	"bearer",
	"apiKey",
	"deviceAuthorization",
] as const;

export const PUSH_TRANSPORTS = ["apns", "fcm", "unifiedpush"] as const;

export const serverInfoSchema = z
	.object({
		name: z.literal("Retrospend"),
		version: z.string().meta({ examples: ["0.5.0"] }),
		apiVersion: z.literal("v1"),
		minClientVersion: z.string().meta({
			description: "Older app builds must ask the user to update.",
		}),
		features: z.object({}).meta({
			description:
				"Optional server capabilities. Empty today: clients still read the object, so it stays.",
		}),
		auth: z.object({
			methods: z.array(z.enum(AUTH_METHODS)),
			signUp: z.enum(["open", "inviteOnly"]),
		}),
		push: z.object({
			transports: z.array(z.enum(PUSH_TRANSPORTS)),
		}),
	})
	.meta({ id: "ServerInfo" });

export type ServerInfo = z.infer<typeof serverInfoSchema>;

/**
 * The credential behind a request, from the session itself rather than the
 * transport: the web app, the mobile app, a device-authorized client or an
 * API key.
 */
export const PRINCIPAL_KINDS = ["web", "mobile", "device", "apiKey"] as const;

export const principalSchema = z
	.object({
		kind: z.enum(PRINCIPAL_KINDS),
		scopes: z.array(scopeSchema),
		expiresAt: z.iso.datetime({ offset: true }).nullable(),
		clientId: z.string().nullable(),
	})
	.meta({ id: "Principal" });

export const meSchema = z
	.object({
		id: z.string(),
		email: z.string(),
		username: z.string(),
		name: z.string(),
		image: z.string().nullable(),
		/** The uploaded picture, else the sign-in provider's (image), else null. */
		avatarUrl: z.string().nullable(),
		role: z.enum(["USER", "ADMIN"]),
		homeCurrency: z.string(),
		defaultCurrency: z.string(),
		fiscalMonthStartDay: z.int().min(1).max(28),
		language: z.string(),
		emailVerified: z.boolean(),
		twoFactorEnabled: z.boolean(),
		createdAt: z.iso.datetime({ offset: true }),
		principal: principalSchema,
	})
	.meta({ id: "Me" });

export type Me = z.infer<typeof meSchema>;

export const platformContract = {
	serverInfo: v1
		.route({
			method: "GET",
			path: "/server-info",
			operationId: "getServerInfo",
			tags: ["Platform"],
			summary: "What this server is and supports",
			description:
				"Public. Clients probe it when connecting to a server URL. The features reflect the caller when it sends credentials.",
		})
		.meta({ scope: "public" })
		.output(serverInfoSchema),
	me: v1
		.route({
			method: "GET",
			path: "/me",
			operationId: "getMe",
			tags: ["Platform"],
			summary: "The signed-in user and the credential in use",
		})
		.meta({ scope: "read" })
		.output(meSchema),
};
