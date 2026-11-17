# Platforms

Selector status and platform quirks for the job boards and every ATS the apply runner drives. This is platform knowledge built into the code. It is not a workspace's channel verification: on a fresh workspace every channel in `config/apply.json` `verified` is false until the operator checks that channel's headed dry run (`npm run apply -- verify --channel <name> --evidence <run dir>`).

**Status values:**

| Status | Meaning |
|---|---|
| verified YYYY-MM-DD | A headed run on a live page confirmed it on that date |
| offline replay | Confirmed only against a saved capture (`node scripts/replay-capture.mjs`) or a synthetic fixture in `tests/fixtures/` |
| unseen | Built from public notes or a fixture; no live page has shown it yet |

For a site quirk, "verified" dates when the quirk was seen on a live page. The runner's handling of it is covered by a test in `tests/` against a synthetic fixture.

A new selector starts as unseen. It becomes verified only after a `--headed` run, and this file changes in the same commit (`docs/runbook.md`, change control).

## Query syntax

| Rule | LinkedIn | Dice |
|---|---|---|
| Quote every multi-word phrase | Required. Unquoted phrases drift: one probe saw 157 results with 4% relevant unquoted, against 3 results, all relevant, quoted | A single quoted phrase works |
| `OR` | Works, including between quoted phrases | Unquoted `OR` works. **Never `"A" OR "B"`**: the firewall answers 403, and `scripts/lib/dice-url.mjs` throws on any query holding a quote and `OR` |
| `NOT`, `(a OR b) NOT c` | Works | Not established |
| `AND` | **Never.** Ignored, with or without parentheses (one test: 497 results, none matching) | Not established |
| Job-type filter | **Never `f_JT` on fractional phrases**: fractional roles are often tagged Full-time. `f_JT=C,P` on plain titles brings contract and part-time leadership roles | `filters.employmentType` narrows to contract types; G1 still reads the job page badges |
| Remote | Classic search takes `f_WT=2`. AI search strips it, so the prefilter's G2 does the work | `filters.workplaceTypes=Remote` also returns "Remote or Hybrid in <city>": the job page badge decides |
| AI search | Ignores quotes (semantic ranking); high top-25 precision; never legitimately empty, which makes it the canary | n/a |

## LinkedIn

**Session:** `npm run jobs -- whoami` (one feed load). Re-login: `npm run jobs -- login` in a real terminal.

### URL parameters

| Param | Meaning | Status |
|---|---|---|
| `f_TPR=r<seconds>` | Posted window | verified 2026-10-26 |
| `f_WT=2` | Remote (classic only; dropped by the classic redirect below) | verified 2026-10-26 |
| `f_JT=C,P` | Contract, Part-time (dropped by the classic redirect below) | verified 2026-10-26 |
| `geoId=103644278` | United States. Metro geoIds come from the UI's location field | verified 2026-10-26 |
| `sortBy=DD` | Most recent (classic only; dropped by the classic redirect below) | verified 2026-10-26 |
| `f_E=5,6` | Director, Executive | verified 2026-10-26 |
| `/jobs/search-results/` (AI search) | Keeps `keywords`, `geoId`, `f_TPR`. Strips `f_WT` and `sortBy`. Ignores quotes | verified 2026-10-26 |
| AI search remote and employment-type codes | Unknown. One manual click in the UI each; automation never clicks filters | unseen |
| `/jobs/search/` (classic) | **Redirects to `/jobs/search-results/`** (the AI search) in probes since 2026-11-05. The final URL keeps `keywords`, `geoId` and `f_TPR` and drops `f_JT`, `f_WT` and `sortBy`, so a classic query's filters no longer apply: the prefilter's G2 is the only remote check. Treat it as the classic-search watch event (`docs/runbook.md`): a probe moves the classic queries to the AI search. Check the final URL of a probe, not the one requested | redirect seen 2026-11-17 |

### Selectors (`JOBS_SEL` in `scripts/linkedin-jobs.mjs`)

| Surface | Selector or signal | Status |
|---|---|---|
| Signed-in marker | `#global-nav`, `.global-nav__me` | verified 2026-06-04 |
| Login wall | URL `/login`, `/checkpoint`, `/authwall` | verified 2026-06-04 |
| Search list items | `li[data-occludable-job-id]` | verified 2026-10-26 (25 of 25 cards) |
| AI search cards | `[componentkey^="job-card-component-ref-"]`, the ID is the suffix | verified 2026-10-27 |
| Job ID fallback | `[data-job-id]`, `a[href*="/jobs/view/"]` outside the detail pane | unseen (list items were always present) |
| Empty marker | "No matching jobs found" in a `p` **above** `<main>`; filler "Jobs you may be interested in" cards follow it and are dropped (`filler_count`) | offline replay |
| Result count | `.jobs-search-results-list__subtitle` or "N results" text | verified 2026-10-26 |
| List scroll container | Nearest scrollable ancestor of the first list item | verified 2026-10-26 |
| View title | `h1`, else `document.title` before the first " \| " (the newer UI has no `h1`) | offline replay |
| View top card | `[class*="top-card"]`, else the main text above "About the job" | offline replay |
| View description | Nearest ancestor of the "About the job" heading that holds more than the heading. `ok` needs a title and 100+ description characters | verified 2026-10-26 |
| View company | First `a[href*="/company/"]` with text (the first link is the logo) | offline replay |
| Closed-job marker | "No longer accepting applications" | unseen |
| Apply control, Easy Apply | First `button` or `a` in the top card whose aria-label or text names Apply; `aria-label="Easy Apply to this job"` | offline replay |
| Apply control, external | The same control, `aria-label="Apply on company website"`, a button with no href. The ATS URL is found only by clicking, after approval | verified 2026-10-27 |
| Already-applied marker | "Applied N days ago" or "Application submitted" in the view text | unseen on a fresh page load |

### Easy Apply

| Surface | Selector or behaviour | Status |
|---|---|---|
| Dialog | Visible `[role=dialog]` whose text names an application step. Fields by label, aria-label or fieldset legend (LinkedIn duplicates label text) | verified 2026-10-27 |
| Resume picker | `fieldset[role=radiogroup]` of `div[role=radio][aria-label=<file name>]` cards over hidden inputs; newer rows hold a `div[role=button]` card, a download link and a hidden radio. An older upload is preselected. "Upload resume" opens a native file chooser (no file input). The runner uploads the approved CV (reused while its sha256 is unchanged), selects its card, and stops unless that card is the checked one | verified 2026-10-27 |
| Follow box | `div[role=checkbox][aria-label="Follow <company> ..."][aria-checked=true]` by default. Unticked by clicking the card; Submit is refused while it is ticked | verified 2026-10-27 |
| Checkbox group | `fieldset > div > div > div > input[type=checkbox] + label[for]` (empty label), option text in the `<p>` after the input's wrapper, the question in a `<p>` before the fieldset. A box re-mounts with a new id on change: each box is labelled by its option text, clicked on its row, confirmed by that text | verified 2026-10-30 |
| Yes/No as a checkbox pair | A `<p>` question, then a `fieldset` of two checkboxes with empty `label[for]`, "Yes" and "No" in the `<p>` after each wrapper. Read as one radio-style question; filled by clicking the option's row and confirming exactly that box is ticked | verified 2026-11-03 |
| Screening question | `<p>question*</p>` then a legend-less `fieldset[role=radiogroup]` of `div[role=radio]` cards whose aria-label is the question and whose text is the option. A label shared by every radio in a group is the question, even when the text above is boilerplate | verified 2026-10-27 |
| Unknown question | Stops as `needs_answers`. Answers are stored with `npm run apply -- learn` | verified 2026-10-27 |
| Prefilled answers | LinkedIn fills questions from earlier applications. A prefilled question with no bank answer is asked, never passed through (`prefilled-unvetted`) | verified 2026-10-29 |
| Interstitial | "Job search safety reminder" dialog; the button text is "Continue applying" (its accessible name differs). It also holds the external Apply | verified 2026-10-27 |
| Multi-page flow | "N/5 pages", Next / Review / Submit application. An optional "Mark this job as a top choice" page stays unticked. A page that does not advance stops the run with its validation messages | verified 2026-10-27 |
| Submit and confirmation | "Submit application"; then "Your application was sent to <company>!" plus an upsell. Nothing is clicked after the confirmation | verified 2026-10-27 |

## Dice

**Session:** `npm run dice -- whoami`. Re-login: `npm run dice -- login` (headed). A cold browser can render a signed-in page as signed out: the runner waits up to 15 s for the account menu, and the tick confirms a sign-out on the home feed before halting.

### URL parameters (`scripts/lib/dice-url.mjs`)

| Param | Value | Status |
|---|---|---|
| `q` | Keywords. A single quoted phrase and an unquoted `OR` work | verified 2026-10-28 |
| `"A" OR "B"` | Firewall 403. The URL builder throws | verified 2026-10-28 (2 of 2 blocked) |
| `filters.workplaceTypes` | `Remote`. Still returns "Remote or Hybrid in <city>": the job page badge decides G2 | verified 2026-10-28 |
| `filters.employmentType` | `CONTRACTS\|PARTTIME\|THIRD_PARTY` | verified 2026-10-28 |
| `filters.postedDate` | `ONE`, `THREE` or `SEVEN`. A query's window maps to the smallest bucket that covers it | `SEVEN` verified 2026-10-28; others unseen |
| `page` | 2 and up | unseen |

### Selectors (`DICE_SEL` in `scripts/dice-jobs.mjs`)

| Surface | Selector or signal | Status |
|---|---|---|
| Cards | `[data-job-guid]`, across three layouts: the plain `job-card`, a card with a description snippet, and "Group by company" (`grouped-job-entry`, the company in the group header) | verified 2026-10-28 |
| No results | `job-search-no-results` | verified 2026-10-28 |
| Job page header | `job-detail-header-card` | verified 2026-10-28 |
| Contract badges | Contract Independent, Contract W2, Contract Corp To Corp | verified 2026-10-28 |
| Work setting | `locationTypeBadge` | verified 2026-10-28 |
| Apply button | `apply-button`, an `<a>`. Easy Apply links to `/job-applications/<guid>/wizard`. After a dry run it reads "Continue Application" (a draft is left) | verified 2026-10-28 |
| Description | The schema.org `JobPosting` script. Its `jobLocationType` says TELECOMMUTE even for on-site roles: never used for G2 | verified 2026-10-28 |

### Dice Easy Apply (`dice-easy`)

| Step | Behaviour | Status |
|---|---|---|
| 1, "Resume & Cover Letter" | The Resume slot shows the profile resume with a "File options" menu (Replace, Delete). **Replace swaps the file for this application only**: the profile resume reads back unchanged. The Cover letter slot is optional; its upload input sits next to the card, `aria-describedby="cover letter-description"` | verified 2026-10-28 |
| File inputs | Never filled from the generic plan (the plan once put the CV into the cover-letter input). Each slot is read from its leaf element, since the card's concatenated text ("Optional" + file name) hides the file name | verified 2026-10-28 |
| 2, "Review your application" | Cards `data-test-id` `sc-resume`, `sc-cover-letter`, `sc-work-authorization`, `sc-candidate-location`, then Submit | verified 2026-10-28 |
| Opt-ins | Follow, subscribe, newsletter, job-alert and SMS boxes are unticked once; no submit while one stays ticked | verified 2026-10-28 |
| Confirmation | "Hooray! Your application is on its way!" | verified 2026-10-28 |

## ATS channels

### Rules for every ATS

| Rule | Behaviour |
|---|---|
| Channel detection | By host (`detectAts` in `scripts/lib/apply-forms.mjs`), table below. An unknown host whose page holds its own application form (a CV upload, or an email box among 4+ inputs) is a per-host `site:<host>` channel: dry runs always, real submits only after the operator verifies that host |
| Application or not | A page is an application only when it asks who you are: a name field or a CV upload. A lone email box is a talent-network or job-alert signup |
| One link away | A job page whose form sits behind one "Apply" link is followed once, then read again |
| Redirectors | `click.appcast.io`, `clickcast.cloud`, `joveo.com`, `jobadx.com`, `recruitics.com` are followed to the employer, sometimes behind a bot check |
| Bot checks | Never solved. Invisible reCAPTCHA (a hidden `bframe` beside a `size=invisible` anchor) is no challenge; hidden hCaptcha frames are none either; a "This site is protected by reCAPTCHA" footer is a notice. A visible challenge in a headed run notifies and waits up to `config/apply.json` `bot_check_wait_minutes` for the operator to solve it in the window; headless, it is a hand-off (`manual`) |
| Bot check after Submit | Over the unsent form (an image challenge after Submit): headed waits, then reads the confirmation again; otherwise `manual`, never `submit-unverified`, so a re-run stays allowed |
| Refused before sending | No confirmation, and required-field errors on a form still there: the site refused it, nothing was sent |
| Submit click | A second, in-page click only when the first provably never fired. An error after the first click fired is rethrown: a second click could send a duplicate |
| Files | A file goes up once per run, whatever its slot is called afterwards |
| Résumé parsing | A parse can overwrite typed values: files go first, and the fill waits until the form is settled (the same fields and values on three looks in a row) |
| Cookie banners | A banner with a backdrop that blocks the form: decline optional cookies. Never "Accept all" |
| Comboboxes | They hold an option, not a sentence: an answer that opens with "Yes," or "No." types only that word. No matching option: a required field stops the run; an optional one is cleared and left blank. Typeahead picks exact text first, then the first suggestion that contains it |
| Help text | A question's description or hint is not an error. A question's own label is not a message. A message under a question already answered is stale |
| Consent boxes | Site terms, privacy, SMS opt-in and AI-analysis consent are the operator's consent: asked unless `profile/answers.json` already answers them |
| AI-applicant question | A question asking whether an AI or bot applies on someone's behalf is never answered No. The operator submits that role by hand |
| Accounts | Created only with `config/apply.json` `accounts.create: true` and a vault adapter (`config/vault.json`). The password is generated, stored and read back before the sign-up form is sent. Never on argv, in data, logs or screenshots. Honeypot fields are never filled |
| Mailed codes and links | Read only from the newest matching mail since the request, with the mail adapter's read verbs (`config/apply.json` `code_wait_seconds`). The only link ever opened is the sign-up verification link of the account just created, on that ATS's own host. A timeout is a hand-off |
| After confirmation | Nothing is clicked |

### Hosts

| Channel | Host |
|---|---|
| `greenhouse` | `*.greenhouse.io` |
| `lever` | `jobs.lever.co` |
| `ashby` | `jobs.ashbyhq.com` |
| `workday` | `*.myworkdayjobs.com`, `*.workday.com` |
| `appcast` | `apply.appcast.io` (a form host; `click.appcast.io` is a redirector) |
| `paylocity` | `recruiting.paylocity.com` |
| `paycor` | `recruitingbypaycor.com` |
| `workable` | `apply.workable.com` |
| `rippling` | `ats.rippling.com` |
| `walmart` | `careers.walmart.com` |
| `icims` | `*.icims.com`, except `icims.com` and `www.icims.com` |
| `site:<host>` | Any other host with its own application form, Gem-hosted forms included |

### Greenhouse

| Surface | Behaviour | Status |
|---|---|---|
| Embedded boards | A careers page with `gh_jid` in the URL and the board name in the embed script's `?for=` resolves to `job-boards.greenhouse.io/embed/job_app?for=<board>&token=<jid>`. The board's job page would redirect back to a custom careers domain | verified 2026-11-04 |
| File slots | A file input's own `label[for]` says "Attach"; the slot name ("Resume/CV", "Cover Letter") heads its `role=group`. Accepts .pdf, .doc, .docx, .txt, .rtf | verified 2026-11-04 |
| Comboboxes | react-select (a real `role=combobox`), with an `aria-hidden` validation shadow input that is not a field | verified 2026-11-04 |
| Checkbox groups | Boxes sharing a name are one question, asked once | verified 2026-11-10 |
| EEO boxes | Race boxes labelled by a sibling `label[for]`, sometimes under an svg: click the label, fall back to a forced check, confirm. "Ethnicity" alone is the Hispanic or Latino question. A label with no `*` span is the question, not a message | verified 2026-11-05 |
| Education | "Start date month/year" is a section date, not availability. The School list may lack the operator's school: optional, so cleared | verified 2026-11-05 |
| Security code | After Submit the page may ask for an 8-character code mailed from `greenhouse-mail.io` ("Security code for your application"). The prompt can sit after a long EEO block. The code is typed box by box and read back; one retry; a code that never reads back right is never submitted. Codes are never recorded, only the shape of a mismatch | verified 2026-11-05 |
| Invisible reCAPTCHA | Loaded on most forms. Not a blocker | verified 2026-11-04 |

### Company-site forms (`site:<host>`)

| Surface | Behaviour | Status |
|---|---|---|
| react-select v1 lists | `div.Select > div.Select-control` holds the search input (`role=combobox`, named by its id or `aria-labelledby`) and the choice in `.Select-value-label`. The widget drops typed text on blur, so each list is a select field (widget `react-select`, no options until searched, required by the `*` before a help tooltip "?"). Plain v1 rows are `.Select-option`, taken on mousedown; react-virtualized-select drawn over v1 renders `div.VirtualizedSelectOption` rows, taken on click, and only the rows in view of `div.VirtualSelectGrid` exist. `rsPick` sets the search text in the page (the whole answer, then its first and last words, `listSearches`), reads every row (scrolling the grid), takes the option `listChoice` names (the same text, else one loose match such as "Masters" for "Master's Degree", else the one option whose name before " - " says the same words, never "Master of Science"), presses it with dispatched mousedown and click events, and confirms the shown choice. A list with no match can show no menu at all | offline replay; collection seen live in a headed dry run |
| react-select Other entry | An answer the list lacks takes the list's Other entry and is typed into the free-text box that appears (`rsPickOther`; the box is tagged `data-hunt-other-for` and read back as the list's `other_text`, its own "Other" label never asked). An Other entry that brings no box is cleared again; a required list then stops the run as `needs_answers` with the nearest options; an optional one is left blank. A help tooltip ("please select Other and fill in the blank") is help text, not validation | offline replay |
| react-select rows per value | A "(Max 2)" list is one react-select per value, every row named by the same `aria-labelledby` (`rs_group`). An answer split on "\|" (`listValues`) is one pick on the first row; each next row is added with the field's "Add ..." button (`rsRow`) and the other rows are covered, not asked | offline replay |
| Optional "Other" upload | A slot labelled just "Other" beside Resume and Cover Letter is optional and left empty | offline replay |

### Lever

| Surface | Behaviour | Status |
|---|---|---|
| hCaptcha | `checkbox-invisible` and challenge frames are kept hidden on every form: not a challenge | verified 2026-11-09 |
| Form | Largest form with a file input or submit; labels by `label[for]`; required by `*` or `aria-required` | offline replay |

### Ashby

| Surface | Behaviour | Status |
|---|---|---|
| Job id on a careers page | `?ashby_jid=<uuid>` with no form of its own resolves to `jobs.ashbyhq.com/<slug>/<jid>/application`. The slug is the company name lowercased, suffixes and punctuation dropped; a wrong slug lands on a 404 and the run stops | verified 2026-11-06 |
| Field titles | An id-less input (the Location typeahead) is named by its entry's own `<label>`. A radio group's title is a `<label>` child of the fieldset, not a `<legend>`, and can exceed 160 characters | verified 2026-11-06 |
| Required marks | Only a `_required_` class on the title label: no asterisk, no `required` attribute on radios or checkbox groups | verified 2026-11-05 |
| Yes/No toggles | `button[aria-pressed]` pairs over a hidden checkbox with a name and no id; the question is the `label[for]` that name. Clicked from the page when outside the viewport; confirmed by `aria-pressed` | verified 2026-11-05 |
| Checkbox groups | `fieldset` checkbox-group, the question in its title label, each option in its own `label[for]`: one question | verified 2026-11-05 |
| Dates | react-datepicker takes a date, never a word ("Immediately") | verified 2026-11-05 |
| Autofill upload | "Autofill from resume" is an optional upload under its own heading. Its parse overwrites typed answers | verified 2026-11-04 |
| Notices | The application-limits callout above the form is a notice, not an error | verified 2026-11-06 |
| Submit | The button text can be uppercased by CSS: matched as a whole name in any case. When Playwright cannot scroll it into view, it is clicked from the page | verified 2026-11-10 |
| Image challenge after Submit | A visible reCAPTCHA `bframe` over the form: handled as a bot check after Submit | verified 2026-11-10 |

### Workday

| Surface | Behaviour | Status |
|---|---|---|
| Start | A role whose last run recorded `ats_url` starts there with no board load (`--via-linkedin` forces the old path). Job page `a[data-automation-id=adventureButton]` "Apply"; dialog `[data-automation-id=wd-popup-content]` with `autofillWithResume`, `applyManually`, `useMyLastApplication`, `applyWith<Board>`: only `applyManually` is taken, its href loaded when the click does not route. Cookie banner `legalNoticeDeclineButton` "Decline". A removed posting says "The page you are looking for doesn't exist." (`closed`) | verified 2026-11-09 (headed dry runs reached the account step) |
| Account | `[data-automation-id=signInContent]`, title `#authViewTitle`. Create Account: `input[data-automation-id=email]`, `password`, `verifyPassword`, an optional consent box `createAccountCheckbox` (the operator's consent). `createAccountSubmitButton` sits under a transparent `[data-automation-id=click_filter][aria-label="Create Account"]` that takes the click; pressed once more when nothing posts. Sign In: `signInSubmitButton` under its own `click_filter`. Some boards first show Apple, Google and email sign-in buttons. Honeypot `input[data-automation-id=beecatcher]` is never filled. Vault title `Workday <host>`. The verification link is `/activate/` on the tenant's host | offline replay; account creation unseen |
| Wizard | Root `[data-automation-id=applyFlowPage]`; progress `progressBar` > `progressBarActiveStep`. One question per top-level `[data-automation-id^=formField-]`, named by `data-fkit-id`, required by a `*` in its label | offline replay (synthetic fixtures) |
| Dropdowns | `button[aria-haspopup=listbox]`; options `[role=option]` in the list its `aria-controls` names once open (set only then on some tenants) | offline replay |
| Search prompts | `input[data-uxi-widget-type=selectinput]`: type the words before any bracket, Enter, click the `promptOption` row that is the answer; picks show as `selectedItem`, removed by `DELETE_charm`. Enter alone may pick the only match: a wrong pick is deleted | offline replay |
| Dates | `dateSectionMonth-input`, `Day`, `Year`, typed key by key. A value set at once shows but is not saved | offline replay |
| Radios | By `label[for]`; Yes/No radios may carry only `value=true/false` | offline replay |
| Entries | `[role=group][aria-labelledby$=-section]` with `add-button` ("Add", "Add Another"), filled from the approved CV's roles and `master.json` education | offline replay |
| Resume | `input[data-automation-id=file-upload-input-ref]`; uploaded names `file-upload-item-name`; old files `delete-file` | offline replay |
| Footer | `pageFooterNextButton` ("Save and Continue"; "Submit" on Review, never pressed in a dry run). Errors `errorHeading`, `inputAlert` | offline replay |
| Confirmation | The candidate home `/jobTasks/completed/application` or "Application Submitted" | unseen |

### appcast

| Surface | Behaviour | Status |
|---|---|---|
| Form host | `apply.appcast.io` hosts the form for many staffing firms. Multi-step applyboard ("Step 1/2", Continue): each page filled, Continue followed, stop on Submit | verified 2026-10-29 |
| Labels | "Legal First Name *" is a sibling element; questions are `<p class="required">` above the control; required is a CSS class | verified 2026-10-29 |
| Radios | Styled radios hide the input inside a `<label>`: click the label, then check the input, confirmed by group name and value. Custom `<app-radio-group>` under a question `<p>` | verified 2026-10-29 |
| Location | A zip lookup fills country and city: left alone. Typeaheads want "City, Region, Country" | verified 2026-10-29 |
| Messages | Shown when a step loads and kept after the box is ticked: stale once answered | verified 2026-10-29 |
| Bot check | "Verification Required ... Slide right to secure your access" | verified 2026-10-29 |
| Confirmation | "Thank you for submitting!" | verified (date not recorded) |

### Paycor

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page applies through a hidden form posted by a div's onclick ("Apply for this Position", `ns-qa="applyBtn"`). It opens the guest flow and sends no data. Embedded on an employer's page, Apply posts back to the parent site (`parentUrl`): the standalone URL is used instead | verified 2026-11-04 |
| Flow | Guest flow, an EEO notice and self-ID screens, then the form | verified 2026-11-04 |
| Resume | Upload in a form of its own: the form root is widened to include it | verified 2026-11-04 |
| Selects | "Please Select" is a placeholder, not a message | verified 2026-11-04 |
| SMS opt-in | A radio in a parent of its own, enabled only once a phone is in: the form is read again after a fill | verified 2026-11-04 |
| EEO | Gender and race groups are both named "Gender, Ethnicity/Race": the options decide which is which | verified 2026-11-04 |

### Paylocity

| Surface | Behaviour | Status |
|---|---|---|
| URL | `/Recruiting/Jobs/Details/<id>` lists the job; the form is `/Recruiting/Jobs/Apply/<id>` (guest application) | verified 2026-11-04 |
| Resume | A hidden input with no label, named only by the button after it ("Select Resume to Upload"). Every upload re-parses the resume and rewrites the form in the background: one upload per run, then wait until settled | verified 2026-11-05 |
| Work history | The parser decides the entries and their order. Per-entry answers are keyed by the company name each entry shows; fields are remembered by element id because labels repeat | verified 2026-11-04 |
| Dropdowns | react-widgets (`div[role=combobox].rw-dropdownlist`, list named by `aria-owns`, choice in `.rw-input`): open, pick, confirm. Options can carry a star ("Yes*"). Selects keep the choice in a single-value element beside an empty input | verified 2026-11-05 |
| State and country | The State list holds names but shows the picked code ("CA"); some country lists spell names differently | verified 2026-11-04 |
| Fields | A date input takes YYYY-MM-DD only. Playwright's fill can time out after the parse: the field is focused and typed from the keyboard. "SMS permission required" outside a label is a message | verified 2026-11-05 |
| Navigation | "Next Step". A very long page: the button is scrolled into view first | verified 2026-11-04 |

### Workable

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page links to its guest form at `/apply/` | verified 2026-11-04 |
| Cookie banner | A backdrop blocks the form: decline the optional cookies | verified 2026-11-04 |
| CV slot | Relabelled "Replace file" once a file is in: never uploaded again | verified 2026-11-04 |

### Rippling

| Surface | Behaviour | Status |
|---|---|---|
| Start | The job page's "Apply now" is a button that routes to `<board>/jobs/<uuid>/apply` (query kept). The form renders after load (Next.js): wait for the inputs | offline replay; headed dry runs 2026-11-09 |
| Uploads | `input[type=File]` inside `label[aria-labelledby]` naming the field title ("Résumé", "Cover letter"); required by a sibling `*` span. The CV upload starts a parse ("Parsing the résumé..." then "Résumé parsing was successful.") that overwrites typed values: files first, then wait | offline replay |
| Menus | Gender, Hispanic/Latino, Veteran Status and custom questions are input-less `div[role=combobox]` menus; options render on open in the list `aria-controls` names (read once per run). They open on focus (never Tab into them) and close only on an outside mousedown, not Escape, blur or a second click. A sticky Apply bar covers boxes near the bottom: centre first | offline replay |
| Custom questions | Named by the `<p>` above the field block; required only by a CSS `::after { content: "*" }` | offline replay |
| SMS opt-in | `role=radiogroup` of `div[role=radio][aria-labelledby]` cards under a long `<p>`: the operator's consent | offline replay |
| Apply | `button[type=submit]` `aria-disabled=true` until the form is complete. Cloudflare Turnstile (`#turnstile-container`) runs on Apply | unseen |
| Confirmation | "You have successfully applied to <role>" | unseen |

### iCIMS

| Surface | Behaviour | Status |
|---|---|---|
| Frame | Each employer is its own host. The career site draws the portal in `iframe#icims_content_iframe` (src `...&in_iframe=1`); loaded alone that URL bounces back, so the runner drives the frame in place (`framed()`). Humanized typing into the cross-origin frame keeps only the first key: one fill, then a synthetic key event; no mouse inside the frame | verified 2026-11-10 |
| Login | A recorded `/jobs/<id>/login` URL starts there. `form#enterEmailForm`, `input#email` (`name=css_loginName`), the privacy box (`#accept_privacy`, or `#accept_gdpr` after a GDPR block: the operator's consent), `input#enterEmailSubmitButton` "Next", disabled until ticked | verified 2026-11-10 |
| hCaptcha | An invisible hCaptcha (`div.h-captcha[data-size=invisible]`) and the "Protected by hCaptcha" badge are no bot check. An image challenge can still appear after Next: the operator solves it in the headed window | verified 2026-11-10 |
| Profile form | `form#profileForm`. "Connect your account" social buttons are never pressed. The résumé slot sits behind My Computer and cloud-drive buttons ("Existing data in the form will be replaced"): the CV goes first, and choosing it posts the whole form back, so the runner waits for the new document and reads the plan again. "Create a login" (`PersonProfileFields.Login`), `.Password`, `.Password_Confirm`: vault title `iCIMS <host>`; a locked vault is a hand-off. Fields by `label[for]`, required by `aria-required` or `iCIMS_Forms_RequiredField` | markup seen 2026-11-10; filling offline replay |
| Dropdowns | A hidden `select.dropdown-hide` (options by AJAX), `a.dropdown-select[role=combobox][id=<select id>_icimsDropdown]` with the choice in `.dropdown-text`, options `ul#<select id>_dropdown-results li[role=option]` (match the text, not `title`, which double-escapes apostrophes). Searchable lists show their first 25 until typed into and search on a real keyup. State/Province says "No Results" until Country is chosen: Country first. A list that lacks the answer may offer an Other entry plus an "Other <field>" box | offline replay |
| Navigation | Next or Continue on question and EEO pages ("Submit Profile" on a profile page); Submit only on a review page. A Submit anywhere else is held and the run stops (`manual`). Apply with LinkedIn or Indeed, cloud imports, Back and Save for Later are never pressed | offline replay |
| Codes and links | A six-digit code from the newest iCIMS mail since the request; a link only on the portal's own host | unseen |

### Gem

| Surface | Behaviour | Status |
|---|---|---|
| Final button | "Apply and save" creates a Gem account; "Apply without saving" does not. Only the second is ever pressed | verified 2026-11-09 |
| Long questions | A free-text box can carry a question longer than 160 characters: its label is read whole, so the required answer is typed | offline replay |

### Walmart (`careers.walmart.com`)

| Surface | Behaviour | Status |
|---|---|---|
| Job page | One Next.js app for the Walmart-family brands. `/us/en/jobs/R-<id>`: `button[data-id=job-apply-button]` "Apply now" ("Applied" once applied), one per responsive pane, only the shown one clicked. It routes in the page to `/jobs/apply` (job id in sessionStorage `jobsContext`), so the recorded `ats_url` stays the job page | verified 2026-11-09 |
| Contact page | `/jobs/contact-details`, "Let us know how to contact you": `input#email`, the site terms box (a `label` wrapping the checkbox, with a "Read more" button inside the label: the operator's consent), Continue `button[aria-label=Continue]` disabled until ticked | verified 2026-11-09 |
| Code page | "Check your email for the verification code.": `input[data-testid=otp-input-0..5]`, `otp-verify-button` "Verify". The code comes from the newest Walmart mail since the request. Backspace in an empty box clears the previous box and moves back to it | offline replay |
| Questionnaire | `form[aria-labelledby=questionnaire-title]`, progress `main nav[aria-label]`. Server-defined questions as `label[for]` fields, native selects, radios and checkboxes. The résumé upload sits over a hidden file input ("Uploading Resume...", "Parsing Resume...", waited out). `data-testid=button-input_*` buttons (use my last application, apply with another site) are never pressed. SSN boxes `input[id^=ssn-input-]` are asked | offline replay |
| Navigation and submit | Next or Continue on a page; Submit only on the review page (an "Edit" per section). A review whose cart holds more than one job ("You are applying to <n>") is refused. Confirmation `/jobs/submitted?applicationGroupId=...`, "Application Submitted!" | offline replay |
