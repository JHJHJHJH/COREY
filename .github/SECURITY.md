# Security Policy

## Supported Versions

Security fixes target the latest released version of COREY.

## Reporting Vulnerabilities

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting if it is enabled for the repository, or contact the
maintainers privately.

Include:

- affected version or commit
- reproduction steps
- impact
- whether model files, credentials, or stored backend data are involved

## Deployment Notes

COREY's backend is designed for self-hosted, single-tenant deployments. Do not
expose it directly to the public internet without a reverse proxy or gateway
that provides TLS, authentication, payload limits, and rate limiting.
