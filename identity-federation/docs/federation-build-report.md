# Federation Build Report — Entra ID to AWS Console

*Workforce federation exercise capturing what enterprise customers experience configuring an external IdP into AWS.*

## Executive summary

<!-- 1 short paragraph: who the customer is, what was configured, the single most-impactful friction observation, and the 2–3 product opportunity themes. Fill in after the build is mostly complete. -->

## Customer scenario for the build

<!-- 1 paragraph. Enterprise IT admin at a mid-size company already standardized on Microsoft Entra ID for workforce identity. Goal: let employees sign into AWS Console with their existing Entra credentials, without re-creating user identities inside AWS. -->

## What I configured

<!-- What was set up across Entra, IAM Identity Center, and the AWS account. Brief, factual, list-style. Suggested sub-sections:

- Microsoft Entra ID tenant + test users + test group
- AWS sandbox account
- IAM Identity Center enabled, identity source switched to external IdP
- SAML trust between Entra and IdC (metadata exchange)
- SCIM provisioning (if completed)
- Permission set definitions
- AWS account assignment to test user/group

Reference Appendix B (screenshots) and the evidence directory for raw artifacts. -->

## End-to-end user flow

<!-- Step-by-step what the end user experiences on a sign-in. Each step paired with a screenshot reference (Figure X). The clean path, before discussing friction. -->

## Top friction points

| # | Friction point | Why it matters | Product suggestion |
|---:|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

<!-- Aim for 6–10 entries, stack-ranked. Each row 2–3 sentences per cell. Reuse the Team Vault Top 10 pattern. -->

## Product opportunities

<!-- 3–4 themes that cluster the Top friction list, each tied back to the entries it would retire. Same structure as the Team Vault Product Opportunities section. -->

## Appendix A — Raw pain log

The full log of every observed friction lives in [`../pain-log.md`](../pain-log.md). The Top friction table above is distilled from those entries.

## Appendix B — Screenshots

End-to-end user-journey screenshots in [`screenshots/`](screenshots/).

Suggested set (to be captured during the build):

1. Microsoft Entra ID admin console, AWS app registration view
2. IAM Identity Center identity source configuration page
3. SAML metadata exchange between Entra and IdC
4. Permission set creation in IdC
5. AWS account assignment to a test user/group
6. End user signing into Entra (My Apps or direct AWS app tile)
7. AWS access portal account/permission-set picker
8. AWS Console session opened via the federated role

## Appendix C — Evidence

Raw SAML metadata exports, IdC configuration JSON, and any redacted Entra configuration screenshots are in [`../evidence/`](../evidence/).

## Appendix D — Configuration choices and constraints

This exercise used Microsoft Entra ID and IAM Identity Center as the default modern path. Optional comparisons (Okta, direct IAM SAML role federation, multi-account permission set assignment) are not in scope for the main report but can be added later if requested.

A fresh sandbox AWS account was used so the federation configuration does not affect the IAM Identity Center identity source on the personal account currently hosting the Team Vault demo.
