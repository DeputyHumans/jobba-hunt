# Platforms

Query syntax, selectors and their status, and site quirks for LinkedIn, Dice and every ATS the apply runner drives. This is platform knowledge built into the code. It is not a workspace's channel verification: on a fresh workspace every channel in `config/apply.json` `verified` is false until the operator checks that channel's headed dry run (AGENTS.md "Platform safety").

## Status values

| Status | Meaning |
|---|---|
| ✓ YYYY-MM-DD | Confirmed in a headed run on a live page, on that date |
| ✓ offline | Confirmed only offline: a replay against a saved page (`node scripts/replay-capture.mjs`, LinkedIn only) or a test against a synthetic fixture in `tests/fixtures/` |
| ? | Unconfirmed |

Two qualifiers appear on ATS rows:
- **Date not recorded:** seen in a headed run, but no date was kept. Treat it as `?` for a dated claim.
- **Markup seen:** a literal id or attribute read off a live page. The code does not select by it; the row says how the code finds that element.

The selector tables for LinkedIn and Dice carry the tag in the code: `JOBS_SEL` in `scripts/linkedin-jobs.mjs` and `DICE_SEL` in `scripts/dice-jobs.mjs`. A tag changes in the code and in this file in the same change (AGENTS.md "Platform safety", `docs/runbook.md` "Change control").

Tests for the runner's handling of site markup: `tests/apply-forms.test.mjs`, `tests/apply-dom.test.mjs`, `tests/apply-click.test.mjs`, `tests/apply-phenom.test.mjs`, `tests/dice.test.mjs`, `tests/extract.test.mjs`. The browser-driven tests skip when no Chromium is installed.

## Query syntax

AGENTS.md rules: "Never `AND` on LinkedIn. Never `"A" OR "B"` on Dice (403)." The table explains them.

| Rule | LinkedIn | Dice |
|---|---|---|
| Quoted phrases | Classic search honoured quotes: one probe saw 157 results, 4% relevant, unquoted, against 3 results, all relevant, quoted. AI search ignores quotes, and every classic URL now redirects to AI search (see "LinkedIn") | A single quoted phrase works |
| `OR` | Works, including between quoted phrases | Unquoted `OR` works. `"A" OR "B"`: the firewall answers 403. `buildDiceUrl` throws on any query that holds both a quote and `OR` (`unsafeDiceQuery`, `scripts/lib/dice-url.mjs`) |
| `NOT`, `(a OR b) NOT c` | Works | Not established |
| `AND` | Ignored, with or without parentheses (one test: 497 results, none matching) | Not established |
| Job-type filter | `f_JT=C,P` narrowed classic search to contract and part-time. The classic redirect drops it, and AI search has no known code. On classic search it hid fractional roles, which are often tagged Full-time | `filters.employmentType` narrows to contract types. G1 still reads the job page badges |
| Remote | `f_WT=2` worked on classic search. AI search strips it and the classic redirect drops it, so the prefilter's G2 is the only remote check | `filters.workplaceTypes=Remote` also returns "Remote or Hybrid in <city>": the job page badge decides |
| AI search | Ignores quotes (semantic ranking). High top-25 precision. Never legitimately empty, so the canary runs there | Not applicable |

## LinkedIn

**Session:** `npm run jobs -- whoami` (one feed load). Re-login: `npm run jobs -- login`, by hand in a real terminal.

### URL parameters

`buildSearchUrl` (`scripts/lib/search-url.mjs`) builds every URL from `config/searches.json`: `keywords`, `geoId` (from `geos`), `f_TPR`, the `workplace` entry, the `job_types` entry (only on a query with `job_type`), `sortBy` (from `sort`), the query's raw `params` (applied last, so they win) and `start` for page 2 and up. A query's `base_url` overrides the file's.

| Param | Meaning | Status |
|---|---|---|
| `f_TPR=r<seconds>` | Posted window | ✓ 2026-10-26 |
| `geoId=103644278` | United States. Metro geoIds come from the UI's location field | ✓ 2026-10-26 |
| `f_E=5,6` | Director, Executive | ✓ 2026-10-26 on classic search. Whether the classic redirect keeps it is not recorded |
| `f_WT=2` | Remote | ✓ 2026-10-26 on classic search. AI search strips it; the classic redirect drops it |
| `f_JT=C,P` | Contract, Part-time | ✓ 2026-10-26 on classic search. The classic redirect drops it |
| `sortBy=DD` | Most recent | ✓ 2026-10-26 on classic search. AI search strips it; the classic redirect drops it |
| `/jobs/search-results/` (AI search) | Keeps `keywords`, `geoId`, `f_TPR`. Strips `f_WT` and `sortBy`. Ignores quotes | ✓ 2026-10-26 |
| AI search remote and employment-type codes | Unknown. Finding one takes a manual click in the UI; automation never clicks filters | ? |
| `/jobs/search/` (classic) | Redirects to `/jobs/search-results/`. The final URL keeps `keywords`, `geoId` and `f_TPR` and drops `f_JT`, `f_WT` and `sortBy` | ✓ 2026-11-05 (first seen in probes) |

**The classic redirect.** The template `config/searches.json` still builds classic URLs: `base_url` `/jobs/search/`, `sort: "DD"`, `workplace.remote` `{ "f_WT": "2" }` and `job_types.contract-part-time` `{ "f_JT": "C,P" }`. The redirect drops those filters, so a classic query runs as an AI search with no remote or job-type filter. A probe result keeps `url_requested` and `url_final` per search: read the final one. This is the classic-search event in `docs/runbook.md` "Weekly review": the classic queries need a probe onto AI search (`docs/query-probe-method.md`).

### Selectors (`JOBS_SEL` in `scripts/linkedin-jobs.mjs`)

| Key | Selector | What it finds | Status |
|---|---|---|---|
| `signedIn` | `#global-nav, .global-nav__me, img.global-nav__me-photo` | The signed-in marker | ✓ 2026-06-04 |
| `listItem` | `li[data-occludable-job-id]` | Classic search list items. Virtualized: the ID is there before the card renders | ✓ 2026-10-26 (classic search) |
| `aiCard` | `[componentkey^="job-card-component-ref-"]` | AI search cards, read when no list item exists. The job ID is the suffix | ✓ offline (replayed 2026-10-26) |
| `cardIdAttrs` | `data-occludable-job-id`, `data-job-id` | Fallback ID attributes when neither of the above exists | ? |
| `viewLink` | `a[href*="/jobs/view/"]` | Fallback IDs from links when list items are absent | ? |
| `detailPane` | `.jobs-search__job-details, [class*="job-details"]` | Excluded from the fallback link scan | ? |
| `resultCount` | `.jobs-search-results-list__subtitle, [class*="results-list__subtitle"]` | The result count. Fallback: "N results" in the main text | ? |
| `viewTitle` | `h1` | The job title. Fallback: `document.title` before the first " \| " (the 2026-10 UI has no `h1`) | ? |
| `viewTopCard` | `[class*="top-card"], [class*="topcard"]` | The top card. Fallback: the main text above "About the job" | ? |
| `viewDescription` | `#job-details, .jobs-description__content, .jobs-box__html-content, [class*="jobs-description"]` | Tried first. Under 100 characters, the fallback is the nearest ancestor of the "About the job" `h2`/`h3` that holds 100 or more characters beyond the heading. `ok` needs a title and 100+ description characters | ? |
| `viewCompanyLink` | `a[href*="/company/"]` | The first such link with text, in the top card (else `<main>`). The first link is often the logo | ? |
| `closedMarker` | `/no longer accepting applications\|this job is no longer available\|job (is )?closed/i` on the main text | A closed posting | ? |
| `applyControl` | `button, a` | The first in the top card (else `<main>`) whose aria-label names Apply or whose text is "Apply" or "Easy Apply". `aria-label="Easy Apply to this job"` is Easy Apply. The external control (`aria-label="Apply on company website"`) is a button with no href: the ATS URL is found only by clicking, after approval | ✓ offline Easy Apply (capture 2026-10-26); external ? |

Signals outside `JOBS_SEL` (untagged in the code):

| Signal | Where | Status |
|---|---|---|
| Login wall | `isLoggedOut` (`scripts/cloak-core.mjs`): URL `/login`, `/checkpoint` or `/authwall`; else no signed-in marker and a login link, `.authwall` or `form.login__form` | ? |
| Empty marker | `isEmptyMarkerText` (`scripts/lib/extract.mjs`): "No matching jobs found" and similar, read from headings and paragraphs outside `<main>` as well as inside (the banner sits above `<main>`). The marker beats the card count: the filler "Jobs you may be interested in" cards are dropped and counted in `filler_count` | ✓ offline |
| Scroll container | The nearest scrollable ancestor of the first card; else the window scrolls | ? |
| Already applied | `alreadyAppliedIn`: "Applied N days ago" or "Application submitted" in the main text | ? |

### Easy Apply (channel `easy`)

| Surface | Behaviour | Status |
|---|---|---|
| Dialog | Visible `[role=dialog]` whose text names an application step. Fields by label, aria-label or fieldset legend (LinkedIn duplicates label text) | ✓ 2026-10-27 |
| Resume picker | `fieldset[role=radiogroup]` of `div[role=radio][aria-label=<file name>]` cards over hidden inputs; newer rows hold a `div[role=button]` card, a download link and a hidden radio. An older upload is preselected. "Upload resume" opens a native file chooser (no file input). The runner uploads the approved CV (reused while its sha256 is unchanged), selects its card, and stops unless that card is the checked one | ✓ 2026-10-27 |
| Follow box | `div[role=checkbox][aria-label="Follow <company> ..."][aria-checked=true]` by default. Unticked by clicking the card. Submit is refused while it is ticked | ✓ 2026-10-27 |
| Checkbox group | `fieldset > div > div > div > input[type=checkbox] + label[for]` (empty label), option text in the `<p>` after the input's wrapper, the question in a `<p>` before the fieldset. A box re-mounts with a new id on change: each box is labelled by its option text, clicked on its row, confirmed by that text | ✓ 2026-10-30 |
| Yes/No as a checkbox pair | A `<p>` question, then a `fieldset` of two checkboxes with empty `label[for]`, "Yes" and "No" in the `<p>` after each wrapper. Read as one radio-style question; filled by clicking the option's row and confirming exactly that box is ticked | ✓ 2026-11-03 |
| Screening question | `<p>question*</p>` then a legend-less `fieldset[role=radiogroup]` of `div[role=radio]` cards whose aria-label is the question and whose text is the option. A label shared by every radio in a group is the question, even when the text above is boilerplate | ✓ 2026-10-27 |
| Unknown question | Stops as `needs_answers`. Answers are stored with `npm run apply -- learn`. An AI-applicant question is never learned (see "Rules for every ATS") | ✓ 2026-10-27 |
| Prefilled answers | LinkedIn fills questions from earlier applications. A prefilled question with no bank answer is asked, never passed through (`prefilled-unvetted`) | ✓ 2026-10-29 |
| Interstitial | "Job search safety reminder" dialog; only the "Continue applying" button is clicked (its accessible name differs). It also holds the external Apply | ✓ 2026-10-27 |
| Multi-page flow | "N/5 pages", Next / Review / Submit application. An optional "Mark this job as a top choice" page stays unticked. A page that does not advance stops the run with its validation messages | ✓ 2026-10-27 |
| Submit and confirmation | "Submit application"; then "Your application was sent to <company>!" plus an upsell. Nothing is clicked after the confirmation | ✓ 2026-10-27 |

## Dice

**Session:** `npm run dice -- whoami`. Re-login: `npm run dice -- login` (headed; the window closes once signed in). Dice renders the account menu after the page:
- Every Dice page load waits up to 15 s for the account menu or a Log in / Log out control (`settle`).
- A search or job page that still reads signed out is read again for up to 10 s more.
- A search page with cards, or a job page with a title, that still reads signed out is checked on the home feed (`signedInAtHome`). Signed in there, the page is kept (`anon_header` on a search).
- The tick checks a `login-lost` abort on the home feed before it halts Dice.

### URL parameters (`buildDiceUrl` in `scripts/lib/dice-url.mjs`)

Names and values come from `config/dice-searches.json`. A query's raw `params` are applied after the rest and win.

| Param | Value | Status |
|---|---|---|
| `q` | Keywords. A single quoted phrase and an unquoted `OR` work | ✓ 2026-10-28 |
| `"A" OR "B"` in `q` | Firewall 403. The URL builder throws | ✓ 2026-10-28 (2 of 2 blocked) |
| `countryCode` | Always set: the file's `country`, default `US` | ? |
| `filters.workplaceTypes` | `Remote` (the `workplace.remote` entry; a query without `workplace` takes `remote`). Still returns "Remote or Hybrid in <city>": the job page badge decides G2 | ✓ 2026-10-28 |
| `filters.employmentType` | `CONTRACTS\|PARTTIME\|THIRD_PARTY` (the `employment.contract` entry; a query without `employment` takes `contract`) | ✓ 2026-10-28 |
| `filters.postedDate` | `ONE` (window up to 1 day), `THREE` (up to 3 days), else `SEVEN`: the smallest bucket that covers the query's window (`postedBucket`) | `SEVEN` ✓ 2026-10-28; `ONE`, `THREE` ? |
| `page` | Page 2 and up (`page` is the page index plus 1) | ? |

### Selectors (`DICE_SEL` in `scripts/dice-jobs.mjs`)

The code records these as seen in saved pages of a signed-in session (2026-10-28). Every entry stays `?` until a headed run of `scripts/dice-jobs.mjs` confirms it.

| Key | Selector | What it finds | Status |
|---|---|---|---|
| `signedIn` | `nav[aria-label="Account"] button[aria-haspopup]` | The account menu. A "Log Out" control also counts as signed in; a "Log in" or "Sign in" control or a login link counts as signed out | ? |
| `resultsRoot` | `[aria-label="Job search results"]` | The results list (else the document) | ? |
| `card` | `[data-job-guid]` | Cards in the `job-card` and `grouped-job-entry` layouts. "Group by company" puts the company in the group header | ? |
| `titleLink` | `a[href*="/job-detail/"]` | The title link with text | ? |
| `ariaLink` | `a[aria-label^="View Details for"]` | The title from the aria-label, when the link has no text | ? |
| `companyLink` | `a[href*="/company-profile/"]` | The company. Fallback: the link's `companyname=` query parameter | ? |
| `easyLabel` | `[id="easyApply-label"]` | Easy Apply on the card | ? |
| `typeLabel` | `[id="employmentType-label"]` | Employment type on the card | ? |
| `payLabel` | `[id="salary-label"]` | Pay on the card | ? |
| `emptyMarker` | `[data-testid="job-search-no-results"]` | No results | ? |
| `header` | `[data-testid="job-detail-header-card"]` | The job page header | ? |
| `applyButton` | `[data-testid="apply-button"]` | An `<a>`. Easy Apply links to `/job-applications/<guid>/wizard`. After a dry run left a draft it reads "Continue Application" | ? |
| `locationType` | `[data-testid="locationTypeBadge"]` | Work setting badge; the badges beside it are the header badges | ? |
| `duration` | `[data-testid="contractDurationBadge"]` | Contract duration badge | ? |
| `structuredData` | `script[data-testid="jobDetailStructuredData"]` | The schema.org `JobPosting`: the description, else the "Summary" heading's block. Its `jobLocationType` is not read (it said TELECOMMUTE for on-site roles) | ? |

Parsing outside `DICE_SEL` (`scripts/lib/dice-extract.mjs`):
- **Contract badges:** Contract Independent or 1099 is `1099`. Contract W2 is `w2`. Contract Corp To Corp or C2C is `c2c`. Third Party is `third-party`, read as C2C by G1. Also Full-time, Part-time and a plain Contract.
- **Closed:** "no longer available", "no longer accepting applications", "this job has expired", "this job closed" or "position filled" in the page text. Untagged; treat as `?`.
- **Already applied:** "applied" or "application submitted" in the apply label or the header.

### Dice Easy Apply (channel `dice-easy`)

| Step | Behaviour | Status |
|---|---|---|
| 1, "Resume & Cover Letter" | The Resume slot shows the profile resume with a "File options" menu (Replace, Delete). **Replace swaps the file for this application only**: the profile resume reads back unchanged. The Cover letter slot is optional; its upload input sits next to the card, `aria-describedby="cover letter-description"` | ✓ 2026-10-28 |
| File inputs | Never filled from the generic plan (the plan once put the CV into the cover-letter input). Each slot is read from its leaf element, since the card's text ("Optional" plus the file name) hides the file name | ✓ 2026-10-28 |
| 2, "Review your application" | Cards `data-test-id` `sc-resume`, `sc-cover-letter`, `sc-work-authorization`, `sc-candidate-location`, then Submit | ✓ 2026-10-28 |
| Opt-ins | Follow, subscribe, newsletter, job-alert, marketing and SMS boxes are unticked once; no submit while one stays ticked | ✓ 2026-10-28 |
| Confirmation | "Hooray! Your application is on its way!" | ✓ 2026-10-28 |
| Off-site Apply | An Apply that leaves Dice is followed to the employer's site and run as a company-site form. A known channel that is not verified refuses a real submit (exit 2) until the operator verifies it. Only an unknown site is a hand-off (exit 5) | ? |

## ATS channels

### Rules for every ATS

| Rule | Behaviour |
|---|---|
| Channel detection | By host (`detectAts` in `scripts/lib/apply-forms.mjs`, "Hosts" below). A page that embeds a known ATS in an iframe (Workday excepted) loads that frame. An unknown host whose page holds its own application form (a file input, or an email box among 4+ visible inputs) is a per-host `site:<host>` channel (`siteChannel`, `www.` dropped). Dry runs always; real submits only after the operator verifies that host |
| Unknown or unverified | An unknown site with no form is a hand-off (exit 5, `unsupported application site`). A known or `site:` channel that is not verified refuses a real submit (exit 2) |
| Start URL | A LinkedIn role whose last run recorded `ats_url` (any company-site channel) starts there with no LinkedIn load (`recordedAtsUrl`: the last attempt's `result.json`, never a LinkedIn or Dice page). `--via-linkedin` takes the LinkedIn path. `--ats-url <https url>` starts one run at a known application page; a non-https URL or a LinkedIn or Dice host is ignored and logged. A Dice role always starts on its Dice job page |
| Application or not | A page is an application only when it asks who you are: a name field or a file upload (`applicationForm`). A lone email box is a talent-network or job-alert signup: the run stops (exit 5) |
| One link away | A job page whose form sits behind one "Apply" link or button is followed once, then read again |
| Redirectors | `click.appcast.io`, `clickcast.cloud`, `joveo.com`, `jobadx.com`, `recruitics.com` (`REDIRECT_HOST`) are followed to the employer, up to 3 hops, sometimes behind a bot check |
| Bot checks | Never solved (AGENTS.md "Platform safety"). Invisible reCAPTCHA (a hidden `bframe` beside a `size=invisible` anchor) is no challenge; hidden hCaptcha frames are none either; a "This site is protected by reCAPTCHA" footer is a notice. A visible challenge in a headed run notifies and waits up to `config/apply.json` `bot_check_wait_minutes` (default 10) for the operator to solve it in the window; headless, it is a hand-off (`manual`) |
| Bot check after a stuck Next | The page did not move after Next, shows no field errors or page alerts, and shows a bot check (`afterStuck`): a headed run waits for the operator, then takes the step again once a labelled button is back (`settledAfterChallenge`). Headless or unsolved: `manual`. Nothing was sent |
| Bot check after Submit | Over the unsent form (an image challenge after Submit): headed waits, then reads the confirmation again; otherwise `manual`, never `submit-unverified`, so a re-run stays allowed |
| Refused before sending | No confirmation, and required-field errors on a form still there: the site refused it and nothing was sent (exit 4) |
| Submit button | `submitLabel`: "Submit", "Submit application", "Apply", "Send application" or "Apply without saving", else any label holding "submit". "Apply and save" is never pressed |
| `submit_labels` | `config/apply.json` `submit_labels`: `{ "<channel>": ["<exact button text>", ...] }` for a final button not called Submit. Matched whole, in any letter case, only on its own channel, only when no Submit button shows. An entry is added only after that channel's headed dry run (AGENTS.md "Platform safety") |
| Submit click | A second, in-page click only when the first provably never fired. An error after the first click fired is rethrown: a second click could send a duplicate |
| Files | A file goes up once per run, whatever its slot is called afterwards |
| Résumé parsing | A parse can overwrite typed values: files go first, and the fill waits until the form is settled (the same fields and values on three looks in a row) |
| Cookie banners | At the start of every company-site run (Workday has its own, below) and on each Phenom step that shows a cookie banner, the first visible decline control is clicked: a `button`, `role=button` or link whose whole text matches `COOKIE_DECLINE` ("Decline", "Decline all", "Reject", "Reject all", "Only necessary", "Necessary only", "Use necessary cookies only", an icon before and "cookies" after allowed). "Accept" is never pressed |
| Comboboxes | They hold an option, not a sentence: an answer that opens with "Yes," or "No." types only that word. No matching option: a required field stops the run; an optional one is cleared and left blank. Typeahead picks exact text first, then the first suggestion that contains it |
| Help text | A question's description or hint is not an error. A question's own label is not a message. A message under a question already answered is stale |
| Consent boxes | Site terms, privacy, SMS opt-in and AI-analysis consent are the operator's consent: asked unless `profile/answers.json` already answers them |
| AI-applicant question | Every channel, Easy Apply included. `isAiApplicantQuestion` spots a label asking whether an AI, a bot or an agent applies or fills the form, or acts on someone's behalf. `planFill` never fills it, not even from a learned answer, and the same holds for a checkbox group with that label. `npm run apply -- learn` refuses it. The runner hands the role over: exit 5, outcome `manual`, reason `ai-applicant-question` (`aiApplicantHandoff`). The rule: AGENTS.md "Platform safety" |
| Accounts | The runner never creates an account or types a password (AGENTS.md "Platform safety"). A portal that asks for a sign-in, a new account or an email verification is a hand-off; the operator signs in by hand in a headed run and the browser profile keeps the session. Honeypot fields are never filled |
| Mailed codes and links | Read only from the newest matching mail since the request, with the mail adapter's read verbs, for up to `config/apply.json` `code_wait_seconds` (default 180). The only link opened is the iCIMS link that verifies the application email during the run, on that ATS's own host. A timeout is a hand-off |
| After confirmation | Nothing is clicked |

### Hosts

| Channel | Host |
|---|---|
| `greenhouse` | `*.greenhouse.io` |
| `lever` | `jobs.lever.co` |
| `ashby` | `jobs.ashbyhq.com` |
| `workday` | `*myworkdayjobs.com`, `*.workday.com` |
| `appcast` | `apply.appcast.io` (a form host; `click.appcast.io` is a redirector) |
| `paylocity` | `recruiting.paylocity.com` |
| `paycor` | `recruitingbypaycor.com` |
| `workable` | `apply.workable.com` |
| `rippling` | `ats.rippling.com` |
| `walmart` | `careers.walmart.com` |
| `icims` | `*.icims.com`, except `icims.com` and `www.icims.com` |
| `site:<host>` | Any other host with its own application form, Gem and Phenom forms included |

### Greenhouse

| Surface | Behaviour | Status |
|---|---|---|
| Embedded boards | A careers page with `gh_jid` in the URL and the board name in the embed script's `?for=` resolves to `job-boards.greenhouse.io/embed/job_app?for=<board>&token=<jid>` (`greenhouseFromGhJid`). The board's job page would redirect back to a custom careers domain | ✓ 2026-11-04 |
| File slots | A file input's own `label[for]` says "Attach"; the slot name ("Resume/CV", "Cover Letter") heads its `role=group`. Accepts .pdf, .doc, .docx, .txt, .rtf | ✓ 2026-11-04 |
| Comboboxes | react-select (a real `role=combobox`), with an `aria-hidden` validation shadow input that is not a field | ✓ 2026-11-04 |
| Checkbox groups | Boxes sharing a name are one question, asked once | ✓ 2026-11-10 |
| EEO boxes | Race boxes labelled by a sibling `label[for]`, sometimes under an svg: click the label, fall back to a forced check, confirm. "Ethnicity" alone is the Hispanic or Latino question. A label with no `*` span is the question, not a message | ✓ 2026-11-05 |
| Education | "Start date month/year" is a section date, not availability. The School list may lack the operator's school: optional, so cleared | ✓ 2026-11-05 |
| Security code | After Submit the page may ask for an 8-character code mailed from `greenhouse-mail.io` ("Security code for your application"). The prompt can sit after a long EEO block. The code is typed box by box and read back; one retry; a code that never reads back right is never submitted. Codes are never recorded, only the shape of a mismatch | ✓ 2026-11-05 |
| Invisible reCAPTCHA | Loaded on most forms. Not a blocker | ✓ 2026-11-04 |

### Company-site forms (`site:<host>`)

| Surface | Behaviour | Status |
|---|---|---|
| react-select v1 lists | `div.Select > div.Select-control` holds the search input (`role=combobox`, named by its id or `aria-labelledby`) and the choice in `.Select-value-label`. The widget drops typed text on blur, so each list is a select field (widget `react-select`, no options until searched, required by the `*` before a help tooltip "?"). Plain v1 rows are `.Select-option`, taken on mousedown; react-virtualized-select drawn over v1 renders `div.VirtualizedSelectOption` rows, taken on click, and only the rows in view of `div.VirtualSelectGrid` exist. `rsPick` sets the search text in the page (the whole answer, then its first and last words, `listSearches`), reads every row (scrolling the grid), takes the option `listChoice` names (the same text, else one loose match such as "Masters" for "Master's Degree", else the one option whose name before " - " says the same words, never "Master of Science"), presses it with dispatched mousedown and click events, and confirms the shown choice. A list with no match can show no menu at all | ✓ offline; the collection seen in a headed dry run, date not recorded |
| react-select Other entry | An answer the list lacks takes the list's Other entry and is typed into the free-text box that appears (`rsPickOther`; the box is tagged `data-hunt-other-for` and read back as the list's `other_text`, its own "Other" label never asked). An Other entry that brings no box is cleared again; a required list then stops the run as `needs_answers` with the nearest options; an optional one is left blank. A help tooltip ("please select Other and fill in the blank") is help text, not validation | ✓ offline |
| react-select rows per value | A "(Max 2)" list is one react-select per value, every row named by the same `aria-labelledby` (`rs_group`). An answer split on "\|" (`listValues`) is one pick on the first row; each next row is added with the field's "Add ..." button (`rsRow`) and the other rows are covered, not asked | ✓ offline |
| Optional "Other" upload | A slot labelled just "Other" beside Resume and Cover Letter is optional and left empty | ✓ offline |

### Phenom apply flows

Found on a `site:<host>` channel by the page itself, never by host.

| Surface | Behaviour | Status |
|---|---|---|
| Step bar | `form.rjsf` plus a step bar `li[atm-id][atm-value]` (current `aria-current="step"`, root `.external-job.current-step-<id>`); a `jobSeqNo` URL gets 20 s to draw it (`phenomPage`, `phenomStage`). Step ids: `personalInformation`, `workAndEducation`, `jobSpecificQuestions`, `applicationQuestionnaire`, `supplementaryQuestions`, `voluntaryInformation`, `disabilityInformation`, `applicationReview`. Any other step id is filled as a plain step. The run stops on a page that is not a step: no step bar after 30 s, closed, already applied or submitted. The loader (`.overlaybg`, `.widget-loader` without `.hidden`) is waited out | Seen in headed dry runs, date not recorded; ✓ offline |
| Cookie banner | A shown "Reject all cookies" or "Accept all cookies" button on a step: the decline is clicked (`COOKIE_DECLINE`) | ✓ offline |
| Questions | Each step is one rjsf `fieldset` whose legend is "You are applying for -": a radio question is its own `div[role=radiogroup][aria-labelledby]`, named by that and required by `aria-required` on the group. The hidden "How did you hear about us?" and "Source" selects are not fields | Seen in headed dry runs, date not recorded; ✓ offline |
| Navigation | `phenomNav`: Next before Review, Submit only on Review; a Submit on any other step is held (`manual`). Upload Resume, Apply With LinkedIn, cloud drives, the step tabs, Previous and Save and Exit are never pressed | Next seen in headed dry runs through three steps, date not recorded; Review ? |
| CV first | The CV goes up first and alone, and nothing is typed until the hidden `input#resumeRelativePath` holds a value, the loader is gone and the form has held still 1.2 s (`phenomAwaitResume`): a field change made during the upload can write the form data back without the résumé through its 200 ms debounced update. Next on My information is never pressed without a résumé on record. Other uploads go first too, one at a time (`phenomIdle`) | Seen in headed dry runs, date not recorded; ✓ offline |
| Page alerts | Phenom answers a refused Next with `window.alert()` ("Resume Import is mandatory, ..."). Every dialog is recorded, logged and dismissed, never accepted (`watchDialogs`); an alert after Next is the reason the page did not move (`alertDetail`, `needs_answers`), never read as a bot check | Upload alerts seen in headed dry runs, date not recorded; the refusal ✓ offline |
| Native selects | Set in the page with no key (`selectDirect`): Enter inside the form is an implicit submission that clicks its first untyped button, the second work entry's "Remove experience" | Seen in headed dry runs, date not recorded; ✓ offline |
| My experience | The CV parse writes the work entries (`experienceData[n]`) and the education entry (`educationData[n]`). Parsed entries are left as parsed; an entry's location or dates never take the applicant's own (the section guard covers `experience` ids). A fill that makes a parsed entry disappear stops the run (`entriesLost`). "Additional attachments (Cover Letter, References, etc.)" is named by its heading block and takes the cover letter PDF | Seen in headed dry runs, date not recorded; ✓ offline |
| Upload names | A file name over 50 characters is refused with an alert (the schema's file-name size limit): a copy named by `uploadName` (whole words dropped from the end, the extension kept) goes up instead | Seen in headed dry runs, date not recorded |
| Confirmation | No step bar and `/applythankyou` in the path, or "Your application is processing", "successfully applied" or "thank you for applying" in the text | ? |

### Lever

| Surface | Behaviour | Status |
|---|---|---|
| hCaptcha | `checkbox-invisible` and challenge frames are kept hidden on every form: not a challenge | ✓ 2026-11-09 |
| Form | Largest form with a file input or submit; labels by `label[for]`; required by `*` or `aria-required`. A job URL without `/apply` gets it appended | ✓ offline |

### Ashby

| Surface | Behaviour | Status |
|---|---|---|
| Job id on a careers page | `?ashby_jid=<uuid>` with no form of its own resolves to `jobs.ashbyhq.com/<slug>/<jid>/application` (`ashbyFromJid`). The slug is the company name lowercased, suffixes and punctuation dropped; a wrong slug lands on a 404 and the run stops | ✓ 2026-11-06 |
| Field titles | An id-less input (the Location typeahead) is named by its entry's own `<label>`. A radio group's title is a `<label>` child of the fieldset, not a `<legend>`, and can exceed 160 characters | ✓ 2026-11-06 |
| Required marks | Only a `_required_` class on the title label: no asterisk, no `required` attribute on radios or checkbox groups | ✓ 2026-11-05 |
| Yes/No toggles | `button[aria-pressed]` pairs over a hidden checkbox with a name and no id; the question is the `label[for]` that name. Clicked from the page when outside the viewport; confirmed by `aria-pressed` | ✓ 2026-11-05 |
| Checkbox groups | `fieldset` checkbox-group, the question in its title label, each option in its own `label[for]`: one question | ✓ 2026-11-05 |
| Dates | react-datepicker takes a date, never a word ("Immediately") | ✓ 2026-11-05 |
| Autofill upload | "Autofill from resume" is an optional upload under its own heading. Its parse overwrites typed answers, so it is skipped when a real Resume slot exists | ✓ 2026-11-04 |
| Notices | The application-limits callout above the form is a notice, not an error | ✓ 2026-11-06 |
| Submit | The button text can be uppercased by CSS: matched as a whole name in any case (`buttonNameRe`). When Playwright cannot scroll it into view, it is clicked from the page | ✓ 2026-11-10 |
| Image challenge after Submit | A visible reCAPTCHA `bframe` over the form: handled as a bot check after Submit | ✓ 2026-11-10 |

### Workday

| Surface | Behaviour | Status |
|---|---|---|
| Start | Job page `a[data-automation-id=adventureButton]` "Apply"; dialog `[data-automation-id=wd-popup-content]` with `autofillWithResume`, `applyManually`, `useMyLastApplication`, `applyWith<Board>`: only `applyManually` is taken (`workdayStartChoice`), its href loaded when the click does not route. A removed posting says "The page you are looking for doesn't exist." (`closed`) | ✓ 2026-11-09 (headed dry runs reached the account step) |
| Cookie banner | On each page before the application wizard (the job page, the start dialog, sign-in and account pages), a visible `button` whose whole text is "Decline", "Decline all", "Reject all", "Only necessary" or "Necessary only" is clicked. Markup seen: `legalNoticeDeclineButton` "Decline" | ✓ 2026-11-09 |
| Account | `[data-automation-id=signInContent]`, title `#authViewTitle`; the Create Account form (`createAccountSubmitButton`); the Apple, Google and email sign-in choice (`SignInWithEmailButton`); an email to verify. Each is recognized (`workdayStage`) and handed to the operator, never filled. Honeypot `input[data-automation-id=beecatcher]` is never filled | ✓ offline |
| Wizard | Root `[data-automation-id=applyFlowPage]`; progress `progressBar` > `progressBarActiveStep`. One question per top-level `[data-automation-id^=formField-]`, named by `data-fkit-id`, required by a `*` in its label | ✓ offline (synthetic fixtures) |
| Dropdowns | `button[aria-haspopup=listbox]`; options `[role=option]` in the list its `aria-controls` names once open (set only then on some tenants) | ✓ offline |
| Search prompts | `input[data-uxi-widget-type=selectinput]`: type the words before any bracket, Enter, click the `promptOption` row that is the answer; picks show as `selectedItem`, removed by `DELETE_charm`. Enter alone may pick the only match: a wrong pick is deleted | ✓ offline |
| Dates | `dateSectionMonth-input`, `Day`, `Year`, typed key by key. A value set at once shows but is not saved | ✓ offline |
| Radios | By `label[for]`; Yes/No radios may carry only `value=true/false` | ✓ offline |
| Entries | `[role=group][aria-labelledby$=-section]` with `add-button` ("Add", "Add Another"), filled from `workdayHistory`: the approved CV variant's roles with MM/YYYY dates (a year-only role stays in the CV file). Client roles worked through one employer (a role with `via` naming a `master.employers` key) merge into one entry: the employer's name and dates, the first client role's title, each client's context line as the description. The variant's practice section is an entry after the experience. Education from `master.json` | ✓ offline |
| Resume | The `input[type=file]` inside a `formField-` container; uploaded names `file-upload-item-name`; old files `delete-file`. Markup seen: `input[data-automation-id=file-upload-input-ref]` | ✓ offline |
| Footer | `pageFooterNextButton` ("Save and Continue"; "Submit" on Review, never pressed in a dry run). Errors `errorHeading`, `inputAlert` | ✓ offline |
| Confirmation | A confirmation text ("Application Submitted", `confirmationIn`) or a URL under `/jobTasks/completed` | ? |

### appcast

| Surface | Behaviour | Status |
|---|---|---|
| Form host | `apply.appcast.io` hosts the form for many staffing firms. Multi-step applyboard ("Step 1/2", Continue): each page filled, Continue followed, stop on Submit | ✓ 2026-10-29 |
| Labels | "Legal First Name *" is a sibling element; questions are `<p class="required">` above the control; required is a CSS class | ✓ 2026-10-29 |
| Radios | Styled radios hide the input inside a `<label>`: click the label, then check the input, confirmed by group name and value. Custom `<app-radio-group>` under a question `<p>` | ✓ 2026-10-29 |
| Location | A zip lookup fills country and city: left alone. Typeaheads want "City, Region, Country" | ✓ 2026-10-29 |
| Messages | Shown when a step loads and kept after the box is ticked: stale once answered | ✓ 2026-10-29 |
| Bot check | "Verification Required ... Slide right to secure your access" | ✓ 2026-10-29 |
| Confirmation | "Thank you for submitting!" | Seen in a headed run, date not recorded |

### Paycor

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page applies through a hidden form posted by a div's onclick ("Apply for this Position", `ns-qa="applyBtn"`). It opens the guest flow and sends no data. Embedded on an employer's page, Apply posts back to the parent site (`parentUrl`): the standalone URL is used instead (`paycorStandaloneUrl`) | ✓ 2026-11-04 |
| Flow | Guest flow, an EEO notice and self-ID screens, then the form | ✓ 2026-11-04 |
| Resume | Upload in a form of its own: the form root is widened to include it | ✓ 2026-11-04 |
| Selects | "Please Select" is a placeholder, not a message | ✓ 2026-11-04 |
| SMS opt-in | A radio in a parent of its own, enabled only once a phone is in: the form is read again after a fill | ✓ 2026-11-04 |
| EEO | Gender and race groups are both named "Gender, Ethnicity/Race": the options decide which is which | ✓ 2026-11-04 |

### Paylocity

| Surface | Behaviour | Status |
|---|---|---|
| URL | `/Recruiting/Jobs/Details/<id>` lists the job; the form is `/Recruiting/Jobs/Apply/<id>` (guest application, `paylocityApplyUrl`) | ✓ 2026-11-04 |
| Resume | A hidden input with no label, named only by the button after it ("Select Resume to Upload"). Every upload re-parses the resume and rewrites the form in the background: one upload per run, then wait until settled | ✓ 2026-11-05 |
| Work history | The parser decides the entries and their order. Per-entry answers are keyed by the company name each entry shows; fields are remembered by element id because labels repeat | ✓ 2026-11-04 |
| Dropdowns | react-widgets (`div[role=combobox].rw-dropdownlist`, list named by `aria-owns`, choice in `.rw-input`): open, pick, confirm. Options can carry a star ("Yes*"). Selects keep the choice in a single-value element beside an empty input | ✓ 2026-11-05 |
| State and country | The State list holds names but shows the picked code ("CA"); some country lists spell names differently | ✓ 2026-11-04 |
| Fields | A date input takes YYYY-MM-DD only. Playwright's fill can time out after the parse: the field is focused and typed from the keyboard. "SMS permission required" outside a label is a message | ✓ 2026-11-05 |
| Navigation | "Next Step". A very long page: the button is scrolled into view first | ✓ 2026-11-04 |

### Workable

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page links to its guest form at `/apply/`; a URL without it gets it appended | ✓ 2026-11-04 |
| Cookie banner | A backdrop blocks the form until the optional cookies are declined (the cookie rule above) | ✓ 2026-11-04 |
| CV slot | Relabelled "Replace file" once a file is in: never uploaded again | ✓ 2026-11-04 |

### Rippling

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page's "Apply now" is a button that routes to `<board>/jobs/<uuid>/apply` (query kept, `ripplingApplyUrl`). The form renders after load (Next.js): wait for the inputs | ✓ 2026-11-09 (headed dry runs); ✓ offline |
| Uploads | `input[type=File]` inside `label[aria-labelledby]` naming the field title ("Résumé", "Cover letter"); required by a sibling `*` span. The CV upload starts a parse ("Parsing the résumé..." then "Résumé parsing was successful.") that overwrites typed values: files first, then wait | ✓ offline |
| Menus | Gender, Hispanic/Latino, Veteran Status and custom questions are input-less `div[role=combobox]` menus; options render on open in the list `aria-controls` names (read once per run). They open on focus (never Tab into them) and close only on an outside mousedown, not Escape, blur or a second click. A sticky Apply bar covers boxes near the bottom: centre first | ✓ offline |
| Custom questions | Named by the `<p>` above the field block; required only by a CSS `::after { content: "*" }` | ✓ offline |
| SMS opt-in | `role=radiogroup` of `div[role=radio][aria-labelledby]` cards under a long `<p>`: the operator's consent | ✓ offline |
| Apply | `button[type=submit]` `aria-disabled=true` until the form is complete. Cloudflare Turnstile runs on Apply: a shown `challenges.cloudflare.com` or `turnstile` frame is a bot check (`blockerIn`, `challengeIn`). Markup seen: `#turnstile-container` | ? |
| Confirmation | "You have successfully applied to <role>" | ? |

### iCIMS

| Surface | Behaviour | Status |
|---|---|---|
| Frame | Each employer is its own host. The career site draws the portal in `iframe#icims_content_iframe` (src `...&in_iframe=1`); loaded alone that URL bounces back, so the runner drives the frame in place (`icimsFrameIndex`: the frame named `icims_content_iframe`, else one on an iCIMS host showing a `/jobs/` page). Humanized typing into the cross-origin frame keeps only the first key: one fill, then a synthetic key event; no mouse inside the frame | ✓ 2026-11-10 |
| Login | A recorded `/jobs/<id>/login` URL starts there. The code finds the controls by role and wording, not by portal ids (`icimsPage` tags them for `ICIMS_SEL`): the email box (`type=email`, or "email" in its id, name or autocomplete, tagged `data-hunt-email`), the checkboxes in its form (tagged `data-hunt-consent`; a box that says only "I accept" is named with the block before it; the operator's consent), and the submit or Next/Continue button (`data-hunt-next`). Markup seen: `form#enterEmailForm`, `input#email` (`name=css_loginName`), `#accept_privacy`, `#accept_gdpr` after a GDPR block, `input#enterEmailSubmitButton` "Next", disabled until ticked | ✓ 2026-11-10 |
| hCaptcha | An invisible hCaptcha (`div.h-captcha[data-size=invisible]`) and the "Protected by hCaptcha" badge are no bot check. An image challenge can still appear after Next: the operator solves it in the headed window (the stuck-Next rule above) | ✓ 2026-11-10 |
| Profile form | "Connect your account" social buttons are never pressed. The résumé slot sits behind My Computer and cloud-drive buttons ("Existing data in the form will be replaced"): the CV goes first, and choosing it posts the whole form back, so the runner waits for the new document and reads the plan again. "Create a login" (`PersonProfileFields.Login`), `.Password`, `.Password_Confirm`: vault title `iCIMS <host>`; a locked vault is a hand-off. Fields by `label[for]`, required by `aria-required` or `iCIMS_Forms_RequiredField`. Markup seen: `form#profileForm` | Markup seen 2026-11-10; filling ✓ offline |
| Dropdowns | A hidden `select.dropdown-hide` (options by AJAX), `a.dropdown-select[role=combobox][id=<select id>_icimsDropdown]` with the choice in `.dropdown-text`, options `ul#<select id>_dropdown-results li[role=option]` (match the text, not `title`, which double-escapes apostrophes). Searchable lists show their first 25 until typed into and search on a real keyup. State/Province says "No Results" until Country is chosen: Country first. A list that lacks the answer may offer an Other entry plus an "Other <field>" box | ✓ offline |
| Navigation | `icimsNav`: Next or Continue on question and EEO pages ("Submit Profile" on a profile page); Submit only on a review page. A Submit anywhere else is held and the run stops (`manual`). Apply with LinkedIn or Indeed, cloud imports, Back and Save for Later are never pressed | ✓ offline |
| Codes and links | A six-digit code from the newest iCIMS mail since the request; a link only on the portal's own host, with a path holding `/activate`, `/verify`, `/verification` or `/confirm` | ? |

### Gem

Gem forms run as `site:<host>` channels.

| Surface | Behaviour | Status |
|---|---|---|
| Final button | "Apply and save" creates a Gem account; "Apply without saving" does not. Only the second is ever pressed | ✓ 2026-11-09 |
| Long questions | A free-text box can carry a question longer than 160 characters: a textarea's label is read up to 300, so the required answer is typed | ✓ offline |
| Unnamed radios | A radio without a `name` is confirmed on itself, by its id: another checked unnamed radio says nothing about it. The `label[for]` beside it is clicked (`checkLabelRadio`) | ✓ offline |
| One field per option | Each radio option of one question can come back as its own field with the same label. The sibling whose option holds the answer is picked; the others are returned as `covered`, so the last check does not ask them | ✓ offline |

### Walmart (`careers.walmart.com`)

| Surface | Behaviour | Status |
|---|---|---|
| Job page | One Next.js app for the Walmart-family brands. `/us/en/jobs/R-<id>`: `button[data-id=job-apply-button]` "Apply now" ("Applied" once applied), one per responsive pane, only the shown one clicked. It routes in the page to `/jobs/apply` (job id in sessionStorage `jobsContext`), so the recorded `ats_url` stays the job page | ✓ 2026-11-09 |
| Contact page | `/jobs/contact-details`, "Let us know how to contact you": `input#email`, the site terms box (a `label` wrapping the checkbox, with a "Read more" button inside the label: the operator's consent), Continue `button[aria-label=Continue]` disabled until ticked | ✓ 2026-11-09 |
| Code page | "Check your email for the verification code.": `input[data-testid=otp-input-0..5]`, `otp-verify-button` "Verify". The code comes from the newest Walmart or Sam's Club mail since the request. Backspace in an empty box clears the previous box and moves back to it | ✓ offline |
| Questionnaire | `form[aria-labelledby=questionnaire-title]`, progress `main nav[aria-label]`. Server-defined questions as `label[for]` fields, native selects, radios and checkboxes. The résumé upload sits over a hidden file input ("Uploading Resume...", "Parsing Resume...", waited out). SSN boxes `input[id^=ssn-input-]` are asked. `walmartNav` presses only Next, Continue, Save and Continue, Next Step, Start or Get Started, never "Use my last application", LinkedIn, Indeed or upload buttons. Markup seen: `data-testid=button-input_*` on those import buttons | ✓ offline |
| Navigation and submit | Submit only on the review page (an "Edit" per section). A review whose cart holds more than one job ("You are applying to <n>") is refused. Confirmation `/jobs/submitted`, or "Application Submitted!" | ✓ offline |
