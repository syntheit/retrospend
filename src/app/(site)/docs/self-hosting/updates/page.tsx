import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { CodeBlock } from "../../_components/code-block"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Updating",
	description: "Keep your Retrospend instance up to date.",
}

const slug = "self-hosting/updates"

export default function UpdatesPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Self-Hosting
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Updating</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Keep your Retrospend instance up to date with the latest images.
				</p>
			</div>

			<h2 id="standard-update" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Standard Update
			</h2>
			<p className="mb-3 text-muted-foreground text-sm leading-relaxed">
				Pull the latest images and restart the stack:
			</p>
			<CodeBlock
				code={`docker compose pull
docker compose up -d`}
				lang="bash"
			/>
			<p className="mt-3 text-muted-foreground text-sm leading-relaxed">
				Database migrations run automatically on startup via the entrypoint
				script. Downtime is typically under 30 seconds.
			</p>

			<Callout variant="tip" title="Back up before upgrading">
				Always snapshot your{" "}
				<code className="font-mono text-xs">postgres_data</code> volume before
				a major update. Run{" "}
				<code className="font-mono text-xs">
					docker exec retrospend-postgres pg_dump -U postgres retrospend &gt;
					backup-$(date +%Y%m%d).sql
				</code>{" "}
				before pulling.
			</Callout>

			<h2 id="watchtower" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Automatic Updates with Watchtower
			</h2>
			<p className="mb-3 text-muted-foreground text-sm leading-relaxed">
				Watchtower can automatically pull and redeploy updated images on a
				schedule:
			</p>
			<CodeBlock
				code={`services:
  # ... your existing services ...

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_CLEANUP: "true"
      WATCHTOWER_SCHEDULE: "0 0 4 * * *"  # Daily at 4 AM`}
				filename="docker-compose.yml (addition)"
				lang="yaml"
			/>
			<Callout variant="warning">
				Watchtower restarts containers automatically, which may cause brief
				downtime. Consider running it during off-peak hours.
			</Callout>

			<h2 id="check-version" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Check Current Version
			</h2>
			<CodeBlock
				code={`docker inspect synzeit/retrospend:latest | grep -i version`}
				lang="bash"
			/>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
