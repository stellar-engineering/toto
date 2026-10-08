---
name: gh
description: Use the GitHub command line to open or review pull requests, read issues, and check on CI runs for this project's repository.
---

# GitHub

`gh` is installed and signed in for this Toto. Use it for anything on GitHub that git alone cannot do.

## Things to know

- **Check you are signed in** with `gh auth status` before the first command. If it says you are not, tell the person to sign in from the Toto app. Do not try to sign in yourself.
- **Look before you write:** `gh pr list`, `gh pr view`, `gh issue view` and `gh run list` change nothing. Opening, merging or commenting is visible to other people, so say what you are about to do first unless you were asked to.
- **Never print or store the token.** Do not run `gh auth token`, and do not put it in a file, a commit or a message.
