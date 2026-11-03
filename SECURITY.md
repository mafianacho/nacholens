# Security policy

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository
(https://github.com/mafianacho/nacholens/security/advisories/new). Do not open a public issue.

Include what you did, what you expected, what happened, and the version (`node src/cli.js help` prints usage; the
version is in `package.json`). You can expect an acknowledgement within a week.

## What counts

nacholens reads a git repository and writes HTML. The parts that matter for security:

- **Reading only.** The CLI runs `git` with fixed arguments (no shell) on the repository you point it at and never executes
  its code. `build`, `diff`, `verify` and `scan` write only to `--out` and, for `init`/`build` without a model, to the model file.
- **Untrusted input in the page.** Model and change-overlay text is inserted with `textContent` only and embedded JSON is escaped
  so it cannot close the script element. A way to get script execution from a model, a diff or a commit message is a vulnerability.
- **Offline output.** The generated page must not load or send anything over the network. A change that makes it do so is a vulnerability.
- **Path handling.** Evidence paths must stay inside the repository; refs are validated. A path or ref that escapes is a vulnerability.
- **Secrets.** `scan` records environment variable *names* only and skips names that look like secrets. Reporting a case where a value
  is read or printed is welcome.

Out of scope: problems in a repository you analyse, or in a model an agent wrote about it (check evidence with `verify`).
