import { type NextRequest, NextResponse } from "next/server";
import { buildCsp, newNonce, TRUSTED_TYPES_REPORT_ONLY } from "~/lib/csp";

const PUBLIC_PATHS = [
	"/login",
	"/signup",
	"/auth",
	"/api/", // All API routes handle their own auth and return JSON errors
	"/privacy",
	"/terms",
	"/join", // Magic link join pages for guest access
	"/guest", // Guest project views (authenticated via x-guest-token header)
	"/projects/", // Individual project pages (public/guest access handled client-side)
	"/u/", // Public user profiles / pay pages
	"/pay", // Payment pages
	"/docs", // Public documentation
	"/fonts/", // Public fonts (used by landing page, docs, etc.)
	"/.well-known/", // App links for the iPhone and Android apps; fetched without a session
];

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const nonce = newNonce();

	// Allow public paths
	if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
		return pass(request, nonce);
	}

	// Allow static assets and Next.js internals
	if (
		pathname.startsWith("/_next") ||
		pathname.startsWith("/images") ||
		pathname.startsWith("/favicon") ||
		// The install manifest and its icons are fetched without a session.
		pathname === "/manifest.webmanifest" ||
		pathname.startsWith("/android-chrome-") ||
		pathname === "/apple-touch-icon.png"
	) {
		return pass(request, nonce);
	}

	// Allow landing page
	if (pathname === "/") {
		return pass(request, nonce);
	}

	// Check for session cookie (better-auth uses this cookie name)
	const sessionToken =
		request.cookies.get("better-auth.session_token") ??
		request.cookies.get("__Secure-better-auth.session_token");

	if (!sessionToken) {
		const loginUrl = new URL("/login", request.url);
		// Keep the query, so /device?user_code=... survives sign-in.
		loginUrl.searchParams.set(
			"callbackUrl",
			`${pathname}${request.nextUrl.search}`,
		);
		return addSecurityHeaders(NextResponse.redirect(loginUrl), nonce);
	}

	return pass(request, nonce);
}

/**
 * Lets the request through. Next reads the nonce out of the request's CSP
 * header and puts it on its own scripts; `x-nonce` is for the few inline
 * scripts the app writes itself (the root layout).
 */
function pass(request: NextRequest, nonce: string): NextResponse {
	const requestHeaders = new Headers(request.headers);
	requestHeaders.set("x-nonce", nonce);
	requestHeaders.set("Content-Security-Policy", cspFor(nonce));
	return addSecurityHeaders(
		NextResponse.next({ request: { headers: requestHeaders } }),
		nonce,
	);
}

function cspFor(nonce: string): string {
	return buildCsp(nonce, process.env.NODE_ENV === "development");
}

function addSecurityHeaders(
	response: NextResponse,
	nonce: string,
): NextResponse {
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("X-XSS-Protection", "1; mode=block");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	response.headers.set(
		"Strict-Transport-Security",
		"max-age=31536000; includeSubDomains",
	);
	response.headers.set("Content-Security-Policy", cspFor(nonce));
	response.headers.set(
		"Content-Security-Policy-Report-Only",
		TRUSTED_TYPES_REPORT_ONLY,
	);
	return response;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
