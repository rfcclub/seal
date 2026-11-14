# Python

**There is no Python package.** The npm package contains only JavaScript and TypeScript. An older version of the usage notes mentioned a Python port kept in a separate local directory. It is not part of this package and could not be verified, so these docs do not describe it.

The route verified from Python is to run the `seal` CLI as a subprocess with `--json` and parse its output. This needs Node (`>=22.5.0`, see [CLI reference](cli.md)) and the package installed in the project directory or globally.

```python
import json
import subprocess


def seal_review(path, artifact_type="design", extra=()):
    """Run the seal CLI and return the parsed verdict. Raises if the CLI did not print JSON."""
    r = subprocess.run(
        ["npx", "seal", "review", path, "--artifact-type", artifact_type, "--json", *extra],
        capture_output=True,
        text=True,
    )
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"seal did not return JSON (exit {r.returncode}): "
            f"{r.stderr.strip() or r.stdout.strip()[:200]}"
        )


v = seal_review("change.md")
print(v["verdict"], v["trust_score"], v["risk_level"])   # PASS 100 MEDIUM
```

Notes from running it:

- The CLI exits 1 for any verdict other than `PASS` and `PASS_WITH_WARNINGS`, so do not use `check=True` and expect a verdict; read the JSON.
- Runtime errors (for example `--risk high` in lower case) exit 1 with the message on stderr and nothing on stdout. The function above raises in that case. Usage errors print the usage text on stdout, which is also not JSON, so they raise too. If the CLI ever prints nothing (releases before `0.6.0-beta.1` did on some Node versions), that raises as well, so the wrapper fails closed.
- The CLI cannot pass test logs, build logs or diffs, so the code-review path (`seal code`) always ends at `REVISE` for want of evidence. For evidence-based review, write a short Node script that calls the [library](api.md) and prints `JSON.stringify(verdict)`, then run that script the same way.
