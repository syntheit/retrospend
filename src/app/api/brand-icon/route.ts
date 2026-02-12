import { type NextRequest, NextResponse } from "next/server";
import { IntegrationService } from "~/server/services/integration.service";

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const domain = searchParams.get("domain");
	const size = searchParams.get("size") ?? "80";

	if (!domain) {
		return new NextResponse("Domain is required", { status: 400 });
	}

	try {
		const brandfetchUrl = `https://cdn.brandfetch.io/${domain}?w=${size}&h=${size}&icon`;

		const response = await IntegrationService.request(brandfetchUrl, {
			headers: {
				// We don't want to pass our own credentials or referrers that might be blocked
				"User-Agent": "Retrospend-Logo-Proxy/1.0",
			},
		});

		const contentType = response.headers.get("content-type");
		const imageBuffer = await response.arrayBuffer();

		return new NextResponse(imageBuffer, {
			headers: {
				"Content-Type": contentType ?? "image/png",
				// Cache for 1 day
				"Cache-Control":
					"public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
			},
		});
	} catch (error) {
		console.error("Error proxying brand icon:", error);
		return new NextResponse("Internal Server Error", { status: 500 });
	}
}
