import { TRPCError } from "@trpc/server";
import { env } from "~/env";

export class IntegrationError extends Error {
	constructor(
		message: string,
		public status?: number,
		public statusText?: string,
	) {
		super(message);
		this.name = "IntegrationError";
	}
}

interface FetchOptions extends RequestInit {
	timeout?: number;
}

const DEFAULT_TIMEOUT = 5000;

export const IntegrationService = {
	/**
	 * Makes a request and returns the raw Response object after confirming it is OK.
	 * Includes timeout and standardized error handling.
	 */
	async request(url: string, options: FetchOptions = {}): Promise<Response> {
		const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				...fetchOptions,
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "Unknown error");
				console.error(
					`Integration error [${response.status}] ${url}: ${errorText}`,
				);

				throw new IntegrationError(
					`External API request failed: ${errorText}`,
					response.status,
					response.statusText,
				);
			}

			return response;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new TRPCError({
					code: "TIMEOUT",
					message: `External API request timed out after ${timeout}ms: ${url}`,
				});
			}

			if (error instanceof IntegrationError) {
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message: error.message,
				});
			}

			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Integration failure: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	},

	/**
	 * Generic method to fetch JSON data with standardized timeout and error handling.
	 */
	async fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
		const response = await this.request(url, options);
		return (await response.json()) as T;
	},

	/**
	 * Specialized request method for Worker internal API.
	 * Injects the WORKER_API_KEY into the Authorization header.
	 */
	async requestWorker(
		endpoint: string,
		options: FetchOptions = {},
	): Promise<Response> {
		const workerKey = env.WORKER_API_KEY;
		if (!workerKey) {
			throw new Error("WORKER_API_KEY is not defined");
		}

		const headers = new Headers(options.headers);
		headers.set("Authorization", `Bearer ${workerKey}`);

		return this.request(endpoint, {
			...options,
			headers,
		});
	},
};
