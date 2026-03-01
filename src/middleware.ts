import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
	"/login",
	"/signup",
	"/auth",
	"/api/", // All API routes handle their own auth and return JSON errors
];

export function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Allow public paths
	if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
		return addSecurityHeaders(NextResponse.next());
	}

	// Allow static assets and Next.js internals
	if (
		pathname.startsWith("/_next") ||
		pathname.startsWith("/images") ||
		pathname === "/favicon.ico"
	) {
		return addSecurityHeaders(NextResponse.next());
	}

	// Allow landing page
	if (pathname === "/") {
		return addSecurityHeaders(NextResponse.next());
	}

	// Check for session cookie (better-auth uses this cookie name)
	const sessionToken =
		request.cookies.get("better-auth.session_token") ??
		request.cookies.get("__Secure-better-auth.session_token");

	if (!sessionToken) {
		const loginUrl = new URL("/login", request.url);
		loginUrl.searchParams.set("callbackUrl", pathname);
		return NextResponse.redirect(loginUrl);
	}

	return addSecurityHeaders(NextResponse.next());
}

function addSecurityHeaders(response: NextResponse): NextResponse {
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
	return response;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
