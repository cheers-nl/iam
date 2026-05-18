# Demo screenshots

Post-tear-down fallback for the live demo referenced in [`../deliverable-6pager.md`](../deliverable-6pager.md).

## What goes here

Three screenshots captured from the live demo before the post-D8 stack tear-down:

1. `01-login.png` — Cognito Hosted UI sign-in page (showing PKCE-protected authorization-code flow), captured at <https://d27nvg04sp0g9m.cloudfront.net>.
2. `02-vault-list.png` — Signed-in admin view showing the seeded vault entries (no real secrets) and the role badge.
3. `03-reveal-with-audit.png` — A reveal action with the resulting audit-log entry visible (timestamp, actor, action, secret ID).

## Capture instructions

```
# 1. Confirm SSO and live demo are up.
aws sso login --profile personal-admin
./scripts/demo-smoke.sh

# 2. Open the demo in a fresh incognito window. Sign in as the
#    admin demo user (credentials in the gitignored
#    .demo-credentials.local.md).

# 3. Capture each of the three views with your OS screenshot tool
#    and save to this directory as 01-login.png, 02-vault-list.png,
#    03-reveal-with-audit.png.

# 4. Verify the screenshots show no real customer data, no real
#    secrets, and no credentials. The seeded demo data is fake.
```

## Why this directory exists before the screenshots do

The 6-pager link to this directory should not 404 even before the screenshots are captured. This README is the placeholder so the path resolves. Replace this file (or leave it adjacent) once the PNGs are in place.
