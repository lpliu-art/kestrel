# Security

Report vulnerabilities privately to the repository maintainers. Do not open a public issue for an unfixed vulnerability.

Kestrel sends redacted diff hunks to the configured Jev provider. Use `--preview --show-payload` to inspect that payload. `--provider mock` and `--provider replay` do not call the network. A missing `TYPESAFE_API_KEY` fails closed (exit 3) in CI and non-interactive shells.
