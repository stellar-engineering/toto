---
name: wrangler
description: Use Cloudflare's wrangler to run, deploy and inspect Workers, and manage D1, R2 and KV, for this project.
---

# Wrangler

`wrangler` is installed, and signed in with an API token that is in the environment as `CLOUDFLARE_API_TOKEN`.

## Things to know

- **Check you are signed in** with `wrangler whoami` before the first command. If it fails, tell the person to sign in again from the Toto app. Do not run `wrangler login`: it needs a browser on this device, and there is none.
- **Look before you change anything:** `wrangler whoami`, `wrangler deployments list`, `wrangler d1 list` and `wrangler tail` only read. A deploy, a delete or a secret changes what is live, so say what you are about to do first unless you were asked to.
- **If it asks which account,** the token can reach more than one. Set `account_id` in the project's wrangler config, or `CLOUDFLARE_ACCOUNT_ID` for the command, and say which you chose.
- **`wrangler dev` runs here on this device,** and is slow on a Raspberry Pi. Prefer a dry run (`wrangler deploy --dry-run`) to check a build.
- **Never print or store the token.** Do not put it in a file, a commit or a message.
