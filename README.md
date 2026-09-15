# Kinomad Studio — site and CRM

Live at **kinomadstudio.com**. The `.dc.html` files in this project are not references or
prototypes: they are the pages the production image serves, byte-for-byte the same as
`cavidyrm/kinomad-frontend@main`. Editing one here and pushing it changes the site.

## What ships

| File | URL | Notes |
| --- | --- | --- |
| `Kinomad Landing.dc.html` | `/` | Hero slat-wipe sequence, services, process, team, FAQ, booking modal |
| `Kinomad Works.dc.html` | `/works` | Websites, Brand identity, 3D & motion — each paginated |
| `Kinomad Website Page.dc.html` | `/website/<slug>` | Case study, 21:10 hero |
| `Kinomad Brand Page.dc.html` | `/brand/<slug>` | Case study, hero at the image's own ratio |
| `Kinomad Motion Page.dc.html` | `/motion/<slug>` | Case study |
| `reels.html` | `/reels` | Public reel index, reads `/api/public/reels` |
| `Kinomad Privacy.dc.html` | `/privacy` | |
| `Kinomad 404.dc.html` | — | Served on any unmatched page route |
| `Kinomad CRM.dc.html` | `/admin` | Internal console — never linked publicly |
| `Kinomad CRM Sign In.dc.html` | `/admin/login` | |

Shared scripts: `km-api.js` (API client), `km-auth.js` (admin session), `km-routes.js`
(clean-URL routing), `support.js` (page runtime), `image-slot.js` (placeholder image
drop target, used where no real asset exists yet).

## Architecture

Static pages in nginx; a Go API at `/api` backed by Postgres; hosted client bundles
proxied at `/demo/<slug>/`. `km-api.js` calls `/api` on the same origin, so there is no
base URL to configure and no CORS. See `deploy/DEPLOY.md`.

Routing lives in `km-routes.js`. The pages work both at their filename URLs (so they open
directly in a design tool) and at clean URLs on the server. Detail routes carry a type
prefix — `/brand/vantar`, not `/works/vantar` — because a static server cannot know a
slug's type; move to `/works/<slug>` with 301s once the backend renders project pages.

All subresources are referenced relatively (`./km-api.js`, `assets/…`). nginx maps
any-depth requests for scripts and assets back to the root so they resolve under nested
routes.

## The CRM

`/admin` manages projects and studio availability. Projects are grouped by type and state
(draft / published); the edit view is the same view used to create.

Behaviour worth knowing before changing it:

- **Autosave** debounces 2s and keeps one save in flight; edits made during a save
  re-queue. Save responses merge back **only server-owned fields** (`id`, `slug`, `state`,
  timestamps) — everything else stays local until the user changes it, so a slow response
  cannot overwrite the field under the cursor.
- **Publish** validates against the server's 422 response, not a local checklist.
- **Shots** span 1–6 columns of a 6-column masonry grid, each with its own ratio. The grid
  packs by shortest column while preserving the order the studio set.
- **Crop previews** sit under the website hero (21:10) and the 3D/motion card (2:3): drag
  to set a focal point, saved as `heroFocus` / `cardFocus`. Brand heroes are not cropped
  and have no preview. See `HERO-FOCUS.md` for the backend fields these need.
- **Scheduler** holds an IANA timezone, a buffer, blocked date *ranges*, and per-meeting
  slot counts.
- **Preview session** (a tweak, on by default) skips the auth gate when no session exists
  so the console can be reviewed without a backend. It bypasses the gate only — every
  panel still calls the real API and shows its own error state.

## Booking

The landing modal fetches availability and busy slots, greys out taken times, and shows
the visitor's local time beside studio time. A 409 on submit means the slot went while the
form was open; the modal refreshes and explains. With no API it degrades to published
studio hours and blocks submission.

Layouts: two-column card on desktop, narrowed rail on tablet, full-height sheet on phones
with the rail folded into a scrolling header and safe-area insets.

## Responsive

Pages are laid out in container-query units against `#frame`. The device tweak
(Desktop / Tablet / Mobile) simulates 393×660 and 834×1112 viewports by making the frame
the scroll container — every scroll read goes through `_sv` / `_sy` / `_vh` / `_sh` and
`_relTop` rather than touching `window` directly, and `vh`-based sections read a `--vh`
variable set from the frame height.

Card reveals respond to hover on pointer devices and to tap on any coarse-pointer device,
at any width. The scrollbar appears after the hero sequence and leaves before the footer.

## Copy and contact

The studio's through-line is **how a business behaves the moment someone meets it** —
"Personality, made visible." The earlier "dream" framing is gone from the site's copy, with one
leftover: the 404 still reads "This dream doesn't exist, or it hasn't been made real yet"
and needs a new line. Anywhere else, if it reappears it is a regression, not a revival.

Two things are load-bearing and easy to break:

- The studio statement's scroll-fill highlights specific words (`behave`, `gap`), matched
  by `_splitWords()` in the Landing logic class. Rewriting that sentence without updating
  the accent list silently drops the highlight.
- The FAQ carries **no prices** — deliberately, at the client's request. The cost answer
  sells the fixed written quote instead.

Footer contact is email, phone and WhatsApp: `Hello@kinomadstudio.com`,
`+971 50 483 9038`, `wa.me/971504839038`. All three use the `.km-flink` underline-draw,
and the email has **no resting underline** — adding a `border-bottom` back alongside that
class stacks two lines.

## Design tokens

Set on `<body>` and shared by every page: `--accent` `#639392`, `--bg` `#1a1a1a`,
`--nav` `#050505`, with `#EDF0F4` as the light-mode background. Type is Chillax and
Gambetta. The same tweak panel (Preview / Brand) is on all nine pages.

## Placeholder content

Pexels stock photography, `localhost` project URLs, reel videos (`assets/reels/*.mp4`, not
in the repo), and `#` social links. Real project content is uploaded through the CRM.

The team section and case-study credits are **no longer placeholder** — Ali Bargi, Pouya
Asri and Aaron Madden are the real studio. The FAQ's 4–8 week timeline is inherited from
placeholder copy and has not been confirmed.
