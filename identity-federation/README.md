# Identity Federation Exercise — Workforce Entra ID into AWS Console

Second hands-on customer-path exercise during my pre-employment AWS IAM onboarding. Follows the [Team Vault](../team-vault/) build (Day 1 deliverable) and shifts the customer viewpoint: from developer building an AWS-native app to enterprise IT admin federating an existing identity provider into AWS.

## What this exercise is

> "Setting identity federation from an IdP like Okta or Microsoft Entra ID to AWS. The learning exercise is to understand what customers experience if their goal is to have users authenticate using one of these IdPs and then land in the AWS console."
> — Kai

The goal is to live through the workforce-federation customer path end to end and record the friction observed, not to ship a polished SSO configuration.

## Configuration choices (locked at start)

| Choice | Decision | Why |
|---|---|---|
| **Identity provider** | Microsoft Entra ID via Microsoft 365 Developer Program | Free tenant; AWS has first-class Entra-to-IdC tutorials; common in enterprise customer base |
| **Federation target** | IAM Identity Center | Modern recommended AWS path for human users; the direct IAM SAML role pattern is legacy |
| **AWS environment** | Fresh sandbox AWS account (not personal account) | Avoids touching the IdC identity source on the account currently used for the Team Vault demo |
| **SCIM provisioning** | Yes, if time permits (recommended) | Closer to real customer setup; without SCIM users must be manually created in IdC |
| **Scope** | Single AWS account, one permission set, end-to-end login flow | Multi-account assignment is bonus, not main path |

If Kai asks for Okta or a direct IAM SAML role federation comparison, the configuration is swappable.

## Customer path being reproduced

```
Microsoft Entra ID (user signs in)
  → SAML assertion
  → IAM Identity Center (validates assertion, maps user)
  → AWS access portal (user picks AWS account + permission set)
  → AWS Console (session opens with permission-set role)
```

Optional SCIM lane: Entra users and groups are pushed to IdC on a schedule; permission-set assignment in IdC is then driven by IdC group membership.

## Deliverable plan

A 2–3 page `Federation Build Report` plus appendices, lighter than the Team Vault Day 1 deliverable (Kai called this a "learning exercise"). Outline:

1. Customer scenario for the build
2. What I configured (Entra + IdC + SAML + SCIM, what each piece does)
3. End-to-end user flow (with screenshots)
4. Top friction points (stack-ranked, ~6–10 entries)
5. Product suggestions (per friction)
6. Appendix A: Raw pain log
7. Appendix B: Screenshots

Hard time limit: **5 working days**. If the main flow is not working by day 4, stop and document what was observed.

## Directory layout

```
identity-federation/
├── README.md                        this file
├── pain-log.md                      raw friction observations (working notebook)
├── docs/
│   ├── federation-build-report.md   Kai-facing deliverable (2–3 pages)
│   ├── observations.md              working notebook, draft prose
│   └── screenshots/                 end-to-end user-journey screenshots
└── evidence/                        raw SAML metadata, IdC config exports
```

## Status

In progress. Day 1: sandbox AWS account registration, Microsoft 365 Developer Program tenant signup, IAM Identity Center enablement.

## Related

- Prior exercise: [`../team-vault/`](../team-vault/) — Day 1 Build Report (Team Vault)
- Top-level overview: [`../README.md`](../README.md)
