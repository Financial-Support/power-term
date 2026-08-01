# Security Policy

power-term handles sensitive data:
- SSH private keys and their passphrases
- Database connection credentials
- AI API keys (Anthropic)
- Cloud-sync credentials (Supabase)

Saved passwords, passphrases, and API keys have a plaintext copy in the local
SQLite credential table so they remain editable without a sync key. Credential
sync is limited to saved-host passwords/passphrases and encrypts every value
with the user's sync key before it leaves the device; raw credential text is
never placed in the outbound sync queue.

## Reporting a vulnerability

If you discover a security vulnerability, please **do not open a public issue**. Instead, email the maintainers directly or open a GitHub Security Advisory.

We will acknowledge receipt within 48 hours and work on a fix. Responsible disclosures will be acknowledged in release notes.

## What to include

- Type of issue
- Steps to reproduce
- Impact assessment
- Any suggested fix (optional)
