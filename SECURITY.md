# Security

Retrospend holds people's financial data, so security reports get priority.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue.

Include what you found, how to reproduce it, and which version or commit you tested. You will get a reply within a few days.

## Supported versions

Security fixes go into the latest release. If you self-host, stay on the latest version: see [docs/self-hosting.md](docs/self-hosting.md#updating).

## Scope

In scope: the web app, the API (`/api/v1`), the sidecar, the mobile apps, and the Docker images built from this repository.

The hosted instance at retrospend.app is in scope, but do not access other people's data, run automated scans that degrade the service, or test social engineering.
