import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Callout } from "../../_components/callout"
import { CodeBlock } from "../../_components/code-block"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Reverse Proxy",
	description: "Configure Nginx or Caddy to serve Retrospend over HTTPS.",
}

const slug = "self-hosting/reverse-proxy"

const NGINX_CONFIG = `server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Recommended SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:1997;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (required for some features)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }
}`

const CADDY_CONFIG = `your-domain.com {
    reverse_proxy localhost:1997 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Optional: increase body size limit for file imports
    request_body {
        max_size 50MB
    }
}`

const CLOUDFLARE_TUNNEL = `# Install cloudflared, then:
cloudflared tunnel login
cloudflared tunnel create retrospend

# Create config.yml
cat > ~/.cloudflared/config.yml << EOF
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:1997
  - service: http_status:404
EOF

cloudflared tunnel route dns retrospend your-domain.com
cloudflared tunnel run retrospend`

export default function ReverseProxyPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Self-Hosting
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Reverse Proxy
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Put Retrospend behind a reverse proxy to serve it over HTTPS with your
					own domain.
				</p>
			</div>

			<Callout variant="info">
				Make sure your <code className="font-mono text-xs">PUBLIC_URL</code>{" "}
				env var matches your domain exactly (e.g.{" "}
				<code className="font-mono text-xs">https://your-domain.com</code>).
				This is used for auth redirects and email links.
			</Callout>

			<h2 id="nginx" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Nginx
			</h2>
			<p className="mb-4 text-muted-foreground text-sm leading-relaxed">
				Install Nginx and Certbot for automatic TLS certificates from
				Let&apos;s Encrypt.
			</p>
			<CodeBlock
				code={`# Ubuntu / Debian
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com`}
				lang="bash"
			/>
			<p className="my-3 text-muted-foreground text-sm">
				Then create a site config:
			</p>
			<CodeBlock
				code={NGINX_CONFIG}
				filename="/etc/nginx/sites-available/retrospend"
				lang="nginx"
			/>
			<CodeBlock
				code={`sudo ln -s /etc/nginx/sites-available/retrospend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx`}
				lang="bash"
			/>

			<h2 id="caddy" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Caddy
			</h2>
			<p className="mb-4 text-muted-foreground text-sm leading-relaxed">
				Caddy handles TLS automatically; no Certbot required. It fetches and
				renews certificates from Let&apos;s Encrypt on its own.
			</p>
			<CodeBlock
				code={`# Install Caddy (Ubuntu)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy`}
				lang="bash"
			/>
			<CodeBlock
				code={CADDY_CONFIG}
				filename="/etc/caddy/Caddyfile"
				lang="text"
			/>
			<CodeBlock
				code={`sudo systemctl reload caddy`}
				lang="bash"
			/>

			<h2 id="cloudflare-tunnel" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Cloudflare Tunnel
			</h2>
			<p className="mb-4 text-muted-foreground text-sm leading-relaxed">
				Cloudflare Tunnel is a good option if your server is behind NAT or you
				don&apos;t want to expose ports 80/443 directly. No port forwarding or
				static IP required.
			</p>

			<Tabs defaultValue="cli">
				<TabsList className="mb-1">
					<TabsTrigger value="cli">CLI setup</TabsTrigger>
					<TabsTrigger value="dashboard">Dashboard setup</TabsTrigger>
				</TabsList>
				<TabsContent value="cli">
					<CodeBlock code={CLOUDFLARE_TUNNEL} lang="bash" />
					<p className="mt-2 text-muted-foreground text-xs">
						Run the tunnel as a service:{" "}
						<code className="font-mono">
							cloudflared service install
						</code>
					</p>
				</TabsContent>
				<TabsContent value="dashboard">
					<ol className="space-y-3 text-muted-foreground text-sm leading-relaxed">
						<li>
							1. Go to{" "}
							<strong className="text-foreground">
								Cloudflare Zero Trust → Networks → Tunnels
							</strong>
						</li>
						<li>2. Create a new tunnel and follow the install instructions</li>
						<li>
							3. Add a public hostname:{" "}
							<code className="font-mono text-xs">your-domain.com</code> →
							Service: <code className="font-mono text-xs">http://localhost:1997</code>
						</li>
						<li>4. Start the cloudflared connector on your server</li>
					</ol>
				</TabsContent>
			</Tabs>

			<Callout variant="tip" title="Trusted origins">
				If you access Retrospend through multiple hostnames (e.g., a tunnel URL
				and your own domain), add the extra origins to the{" "}
				<code className="font-mono text-xs">TRUSTED_ORIGINS</code> env var as a
				comma-separated list.
			</Callout>

			<h2 id="trusted-origins" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Trusted Origins
			</h2>
			<p className="text-muted-foreground text-sm leading-relaxed">
				Better-auth validates the{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">Origin</code>{" "}
				header on auth requests. By default,{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">PUBLIC_URL</code>{" "}
				is trusted. To allow additional origins:
			</p>
			<CodeBlock
				code={`TRUSTED_ORIGINS="https://tunnel.your-domain.com,https://other.your-domain.com"`}
				filename=".env"
			/>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
