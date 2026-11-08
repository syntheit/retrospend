import { env } from "~/env";
import { securityTxt } from "~/lib/security-txt";

export const dynamic = "force-dynamic";

export function GET() {
	const body = securityTxt({
		contact: env.SECURITY_CONTACT,
		publicUrl: env.PUBLIC_URL,
	});
	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
