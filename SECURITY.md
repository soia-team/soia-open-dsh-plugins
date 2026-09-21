# Security Policy

## Supported versions

The `main` branch is currently supported. Plugin releases before the first
tagged version are skeletons and carry no support commitment.

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Once this repository has a remote, use its GitHub private vulnerability
reporting page. Include the affected package and version, reproduction steps,
impact, and any suggested mitigation. Do not include real secrets in the
report; redact them and rotate any credential that may already have been
exposed.

Before a remote exists, report the issue directly to the maintainers through
the channel they already use for this project; do not publish it.

## Scope notes for this repository

These plugins run inside a DeepSeek Harness profile and can register model-facing
tools and hooks that execute on the user's machine. A report is in scope when it
shows that a plugin in this repository can, on its own:

- execute a command, write a file, or reach the network beyond what its README
  documents;
- read or transmit credentials, tokens, or private configuration;
- bypass or silently weaken a Host policy or approval decision;
- make the Host load code that this repository does not publish.

An unverified claim that a skeleton package "does not work yet" is a defect, not
a vulnerability; report it as a normal issue.
