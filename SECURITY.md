# Security Policy

## Supported versions

Blindfold Auth is pre-1.0. During this stage, the latest code on the default branch is the supported version for security fixes.

## Reporting a vulnerability

Please do not open a public issue for undisclosed vulnerabilities.

Use GitHub's private vulnerability reporting for this repository when available. If private reporting is not available yet, contact the maintainers privately through GitHub and include:

- a short summary of the issue
- affected package or deployment lane
- reproduction steps or proof of concept
- impact assessment
- any suggested mitigation

## What to expect

- acknowledgement target: within 5 business days
- status update target: within 10 business days after acknowledgement
- coordinated fix and disclosure timing will depend on severity and exploitability

## Scope

Security reports are especially helpful for:

- authentication bypasses
- session/token handling flaws
- privilege escalation or policy bypasses
- SSO, MFA, or recovery flow weaknesses
- secret leakage, insecure defaults, or supply-chain concerns

## Current hardening references

The current internal hardening notes live in:

- `docs/THREAT_MODEL.md`
- `docs/SECURITY_AUDIT.md`
