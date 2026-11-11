# Cover Letter Approaches

Four letter formats, when to use each, and the file the builder reads. Per-job tailoring (`docs/tailoring.md`) and auto-applied roles use approach A. The examples below are synthetic: Jordan Example applying to Acme Corp. Their claim IDs refer to an imaginary claim bank.

## Rules for every approach

- Claims from `collateral/claim-bank.md` only. Every block cites its claim IDs.
- The posting is quoted verbatim, from the fetched `description_text`. Never draft against a posting that was not fetched.
- Every draft goes through `authentic-prose` (voice in `profile/voice.md`).
- One page, in the CV's typography (`brand/cv/template.css` plus `brand/cv/cover.css`), built by `npm run cover -- --job <id>` (`scripts/build-cover.mjs`).
- 100 to 260 words. No em dashes, no semicolons: the builder refuses both.
- Never "best candidate" or "perfect fit". The fit shows through what is set next to what.
- No rates, no figures without a claim, no story the claim bank does not hold.

## Comparison

| | A. Requirements map | B. First two weeks | C. Three questions | D. Lean letter + P.S. |
|---|---|---|---|---|
| How it stands out | The posting's own words beside the record, plus one honest ramp-up line | Shows how the applicant would start, so the reader pictures them in the job | Questions only a practitioner asks, then the record behind them | Short; the P.S. sends the reader to public work |
| Recruiter scan (staffing screens) | **Fastest**: a checklist ticked in 10 seconds | Medium | Medium | Fast |
| Hiring manager read | Strong | **Strongest** for a buyer who wants a plan | **Strongest** for a technical manager | Adequate |
| Honesty risk | Lowest: each row is a quote and a claim; gaps are named | Medium: a plan can imply work never done | Low to medium: the questions must be sharp, and the tone can read as presumptuous | Low |
| Fit for generated letters | **High**: quotes plus claim match, a fixed structure | Low: needs judgment per role | Low: question quality varies | High |
| Length | About 175 words | About 150 | About 150 | About 140 |

## Recommendation

| Situation | Approach |
|---|---|
| Recruiter-screened roles (staffing firms, Dice), every auto-applied letter, every per-job tailored letter | **A.** Recruiters screen against the posting line by line, and A does that work for them. The ramp-up line buys trust a claim alone cannot |
| Hand-approved roles at product companies with a technical hiring manager | **C** |
| Fractional or interim leadership roles, where the buyer pays for a plan | **B** |
| A posting with fewer than three quotable asks | **D** |

The approach chosen at onboarding is a standing decision in `profile/decisions.md`.

## A. Requirements map

> Hello Acme Corp team,
>
> Your posting lists what this role has to do. Here is what I bring to each part.
>
> | Your posting | My record |
> |---|---|
> | "Operate Kubernetes clusters in production" | I have run production Kubernetes for a payments platform for four years, upgrades and on-call included. |
> | "Own CI/CD for a multi-service platform" | I built and maintain the CI/CD pipeline for 30 services, with automated tests and staged rollouts. |
> | "Mentor engineers across teams" | I lead a weekly design review and have mentored six engineers into senior roles. |
> | "Python or Go" | Python is my main language. I have shipped two internal tools in Go. |
>
> Where I would ramp up: Terraform at your scale. My infrastructure code so far covers one cloud account.
>
> I can start in two weeks. Happy to go through any row on a call.
>
> Best regards,
> Jordan Example

Claims: C02, C05, C07, C09, C11, C12.

## B. First two weeks

> Hello Acme Corp team,
>
> If I joined your platform team, this is how I would start:
> 1. Map every service's deploy path and find the steps that still need a person.
> 2. Measure the slowest pipeline stage and cut it first.
> 3. Shadow one on-call handover with each engineer, to learn where the platform hurts.
>
> I have done this work before. I built and maintain the CI/CD pipeline for 30 services at a payments company, and I have run its production Kubernetes for four years.
>
> I can start in two weeks.
>
> Best regards,
> Jordan Example

Claims: C02, C05, C11.

## C. Three questions

> Hello Acme Corp team,
>
> Three things I would want to understand first about your platform:
> - Which deploys still need a person to press a button, and why?
> - When a service fails at night, how long until the right engineer knows?
> - Do teams own their pipelines, or does the platform team own them all?
>
> I have had to answer these myself. I built the CI/CD pipeline for 30 services at a payments company and have run its production Kubernetes for four years. I also lead a weekly design review across teams.
>
> I can start in two weeks.
>
> Best regards,
> Jordan Example

Claims: C02, C05, C07, C11.

## D. Lean letter plus P.S.

> Hello Acme Corp team,
>
> I'm applying for the Senior Platform Engineer role.
>
> For four years I have run production Kubernetes for a payments platform. I built and maintain its CI/CD pipeline for 30 services, with automated tests and staged rollouts. Python is my main language, and I have shipped two internal tools in Go.
>
> I also lead a weekly design review and have mentored six engineers into senior roles.
>
> I can start in two weeks.
>
> Best regards,
> Jordan Example
>
> P.S. My open-source deploy checker is public, if you want to see how I work before we talk.

Claims: C02, C05, C07, C09, C11, C14.

## Not used, and why

- **A story** ("the night the deploy went wrong"): only when the claim bank holds that incident. Otherwise it would be invented.
- **Unsourced numbers** (uptime, cost saved, team velocity): only figures a claim carries.
- **Pinning a capability to a product or client** when the claim bank keeps them apart.

## `cover-letter.json`

Written to `data/applications/<job_id>/cover-letter.json`. `npm run cover -- --job <id>` validates it, renders `<file_prefix>-cover-letter-<company-slug>.{html,pdf,png}` next to it plus `cover-letter.txt` for typed cover-letter fields, and checks the PDF: one page, embedded fonts with no Type 3, the never-claim lint on the text layer.

| Key | Required | Meaning |
|---|---|---|
| `job_id` | yes | The job the letter is for |
| `company` | yes | Shown in the header and used for the file slug |
| `role` | yes | The "Re" line |
| `ref` | no | Appended to the "Re" line (workplace, job id). A ref naming on-site, hybrid or in-office drops the remote line from the header |
| `to` | no | Default `<company>, hiring team` |
| `date` | yes | As printed |
| `greeting` | yes | "Hello Acme Corp team," |
| `closing` | yes | "Best regards," (the name comes from `profile/person.json`) |
| `map_left`, `map_right` | no | Map column heads. Default "Your posting", "My record" |
| `paragraphs` | yes | Blocks in order. Text block: `{ text, claims: [ids], kind? }`, `kind: "rampup"` styles the ramp-up line. Map block: `{ map: [{ ask, answer, claims }] }`, every row with at least one claim |

```json
{
  "job_id": "9000000001",
  "company": "Acme Corp",
  "role": "Senior Platform Engineer",
  "ref": "Remote (US) · job 9000000001",
  "date": "2026-11-10",
  "greeting": "Hello Acme Corp team,",
  "paragraphs": [
    { "text": "Your posting lists what this role has to do. Here is what I bring to each part.", "claims": [] },
    { "map": [
      { "ask": "Operate Kubernetes clusters in production", "answer": "I have run production Kubernetes for a payments platform for four years, upgrades and on-call included.", "claims": ["C02"] },
      { "ask": "Own CI/CD for a multi-service platform", "answer": "I built and maintain the CI/CD pipeline for 30 services, with automated tests and staged rollouts.", "claims": ["C05"] },
      { "ask": "Mentor engineers across teams", "answer": "I lead a weekly design review and have mentored six engineers into senior roles.", "claims": ["C07"] },
      { "ask": "Python or Go", "answer": "Python is my main language. I have shipped two internal tools in Go.", "claims": ["C09"] }
    ] },
    { "text": "Where I would ramp up: Terraform at your scale. My infrastructure code so far covers one cloud account.", "claims": ["C12"], "kind": "rampup" },
    { "text": "I can start in two weeks. Happy to go through any row on a call.", "claims": ["C11"] }
  ],
  "closing": "Best regards,"
}
```

In a typed cover-letter field the map renders as plain text, one pair per row: `Your posting: "<ask>"` then `My record: <answer>`.
