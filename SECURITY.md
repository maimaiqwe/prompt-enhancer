# Security Policy

## Supported Versions

Security fixes are applied to the latest commit on `main`. Older snapshots and
unreleased local modifications are not separately supported.

## Reporting a Vulnerability

Please report vulnerabilities privately through the repository's GitHub
**Security -> Report a vulnerability** flow. If that flow is unavailable, contact
the maintainer through the public contact method listed on their GitHub profile
and ask for a private reporting channel.

Do not include real API keys, access tokens, personal drafts, or other sensitive
data in an issue, pull request, log, or screenshot. Use redacted examples.

Useful reports include:

- affected version or commit
- Windows and Python versions
- reproduction steps
- expected and actual behavior
- impact assessment
- suggested fix, if available

## Security Model

- `DEEPSEEK_API_KEY` is read from the user's environment and is not stored by
  this project.
- Draft text is sent directly to the configured API endpoint when the hotkey is
  pressed.
- Local history and log files are ignored by Git but are not encrypted.
- The hotkey should only be enabled for trusted desktop processes listed in
  `allowed_processes`.

Please review the privacy notes in `README.md` before processing confidential
material.
