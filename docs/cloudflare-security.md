# Cloudflare Security Configuration Guide

Recommended Cloudflare Tunnel + WAF configuration for Retrospend production deployments.

## Cloudflare Tunnel Setup

Expose Retrospend through a Cloudflare Tunnel (no open ports needed):

```bash
cloudflared tunnel create retrospend
cloudflared tunnel route dns retrospend your-domain.com
```

Config (`~/.cloudflared/config.yml`):
```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:1997
  - service: http_status:404
```

## Rate Limiting Rules

Create these rate limiting rules in Cloudflare Dashboard > Security > WAF > Rate limiting rules:

### Authentication Endpoints
- **Rule name:** Auth rate limit
- **Expression:** `(http.request.uri.path contains "/api/auth/sign-in") or (http.request.uri.path contains "/api/auth/sign-up")`
- **Rate:** 10 requests per minute per IP
- **Action:** Block for 10 minutes

### API Endpoints
- **Rule name:** API rate limit
- **Expression:** `http.request.uri.path contains "/api/trpc/"`
- **Rate:** 200 requests per minute per IP
- **Action:** Block for 1 minute

### Password Reset
- **Rule name:** Password reset rate limit
- **Expression:** `http.request.uri.path contains "/api/auth/forget-password"`
- **Rate:** 3 requests per hour per IP
- **Action:** Block for 1 hour

## WAF Managed Rulesets

Enable under Security > WAF > Managed rules:

1. **Cloudflare Managed Ruleset** - Enable (default action: Block)
2. **Cloudflare OWASP Core Ruleset** - Enable with paranoia level 2
   - Set anomaly score threshold to 25 (moderate)
3. **Cloudflare Exposed Credentials Check** - Enable for sign-in and sign-up paths

## Bot Management

Under Security > Bots:

1. Enable **Bot Fight Mode** (free tier) or **Super Bot Fight Mode** (Pro+)
2. Set "Definitely automated" to Block
3. Set "Likely automated" to Managed Challenge
4. Allow verified bots (search engines)

## Security Headers (Fallback)

The application sets security headers in middleware, but as defense-in-depth, configure Cloudflare Transform Rules (Rules > Transform Rules > Modify Response Header):

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

## DDoS Protection

Under Security > DDoS:

1. HTTP DDoS attack protection is enabled by default
2. Review sensitivity levels — set to "High" for financial applications
3. Enable "Under Attack Mode" temporarily if experiencing active attack

## Firewall Rules (Optional)

Under Security > WAF > Custom rules:

### Geographic Restrictions
If your user base is in specific regions:
```
(not ip.geoip.country in {"US" "CA" "GB" "DE" "FR"})
```
Action: Managed Challenge

### Block Known Bad User Agents
```
(http.user_agent contains "sqlmap") or
(http.user_agent contains "nikto") or
(http.user_agent contains "nmap")
```
Action: Block

## SSL/TLS

Under SSL/TLS:

1. Set encryption mode to **Full (strict)**
2. Enable **Always Use HTTPS**
3. Set Minimum TLS Version to **TLS 1.2**
4. Enable **Automatic HTTPS Rewrites**

## Caching

Under Caching > Cache Rules:

- Bypass cache for `/api/*` paths (API responses should never be cached)
- Cache static assets (`/_next/static/*`) with long TTL
