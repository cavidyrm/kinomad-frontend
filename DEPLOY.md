# Deploying Kinomad

Static frontend in nginx, Go API behind it at `/api`, hosted client bundles at `/demo/<slug>/`.
Everything the frontend needs is in this folder.

```
deploy/
  Dockerfile           frontend image (nginx + the pages)
  nginx.conf           clean URLs, /api and /demo proxies, caching
  docker-compose.yml   web + api + demo + postgres
  .env.example         copy to .env and fill in
```

## Deploy

```bash
cd deploy
cp .env.example .env          # fill PGPASSWORD, SESSION_SECRET, ADMIN_EMAILS
docker compose --env-file .env up -d --build
```

The compose file builds the frontend from this folder. To ship the image CI publishes
instead, comment out `build: .` and uncomment the `image:` line.

**Service names are load-bearing.** `nginx.conf` proxies to `kinomad-api` and
`kinomad-demo` by container name. Renaming a service breaks `/api` and `/demo`.

## How the frontend reaches the backend

`km-api.js` calls `/api` on the same origin — no base URL to configure, no CORS. nginx
forwards it:

| Request | Goes to |
| --- | --- |
| `/api/*` | `kinomad-api:8080/api/*` |
| `/health` | `kinomad-api:8080/health` |
| `/demo/<slug>/*` | `kinomad-demo/<slug>/*` |

Three details in that proxy block are deliberate:

- `location ^~ /api/` — the `^~` prefix stops the regex subresource rules below from
  stealing `/api/assets/<id>/file`.
- `proxy_set_header Authorization` and `proxy_pass_header Set-Cookie` — the admin session
  travels on both, so dropping either breaks sign-in silently.
- `client_max_body_size 520M` — shot and reel uploads. The API's own limit should match;
  if nginx is the smaller of the two the browser gets a bare 413 with no JSON body.

## Routing

Clean URLs, no file renamed:

| URL | Serves |
| --- | --- |
| `/` | `Kinomad Landing.dc.html` (also copied to `index.html`) |
| `/works` | `Kinomad Works.dc.html` |
| `/reels` | `reels.html` |
| `/website/<slug>` | `Kinomad Website Page.dc.html`, rendering that project |
| `/brand/<slug>` | `Kinomad Brand Page.dc.html` |
| `/motion/<slug>` | `Kinomad Motion Page.dc.html` |
| `/privacy` | `Kinomad Privacy.dc.html` |
| `/admin` | `Kinomad CRM.dc.html` |
| `/admin/login` | `Kinomad CRM Sign In.dc.html` |

Direct filename URLs keep working, so the same files open in a design tool and on the
server. `km-routes.js` holds the route table and, only when served from a host, rewrites
internal links to their clean form, sets `<link rel="canonical">`, and reads the project
slug from the path instead of `?project=`. If it fails to load, links fall back to
filename URLs, which nginx still serves — degraded, not broken.

**Why the type prefix.** `/works/<slug>` would need to know a project's type to pick a
template, and only the API knows that. `/brand/vantar` is resolvable by a static server
today. When the backend renders project pages, switch to `/works/<slug>` and 301 these.

**Relative subresources at depth.** The pages reference `./km-api.js`, `./support.js`,
`./image-slot.js` and `assets/…` relatively so they work in a design tool. On a nested
route those resolve below the root, so nginx maps any-depth requests for scripts, styles,
fonts, media and `assets/…` back to the root. `/api/`, `/demo/` and root-level `/assets/`
are excluded from that mapping. `km-api.js` additionally retries from `/km-api.js` if
`window.KMAPI` is still undefined, so a bad base path degrades rather than breaks.

`try_files … /index.html` is deliberately absent from the catch-all: a missing asset
returns a real 404, not 200-with-HTML. Serving HTML for a missing script is what disguised
a missing `km-api.js` as a JavaScript error on an earlier deploy.

## The image asserts its own contents

`Dockerfile` copies by glob (`*.js`, `*.dc.html`, `assets/`) and then checks every required
file is present, failing the build if one is missing. The previous per-file whitelist is
what shipped an image without `km-api.js`. Anything new that lands next to the pages ships
automatically; anything required that goes missing stops the build instead of the site.

## When the API is unreachable

The pages degrade honestly rather than erroring — useful for design review, and the
behaviour to expect during an API outage:

- Landing scheduler shows published studio hours and refuses to submit.
- Works and the detail pages fall back to their built-in sample projects.
- Sign-in blocks with an inline notice; the CRM shows a *Console failed to load* screen.

The CRM also carries a **Preview session** toggle for design review, which skips the auth
gate when no session exists. It only bypasses the gate — every panel still calls the real
API and shows its own error state. Nothing to disable before shipping; once the API issues
sessions the real gate takes over.

`/admin` is currently protected by the API's own session only. To keep unauthenticated
requests from reaching the HTML at all, gate it in nginx:

```nginx
location ~ ^/admin {
    auth_basic "Kinomad";
    auth_basic_user_file /etc/nginx/.htpasswd;
    try_files "/Kinomad CRM.dc.html" =404;
}
```

`auth_request` against the session endpoint is the better version of this once you want a
single source of truth for who is signed in.

## Smoke test

```bash
H=https://kinomadstudio.com

# Backend reachable through nginx
curl -sI  $H/health                  | head -n1   # 200
curl -s   $H/api/public/schedule     | head -c 60 # JSON, not HTML
curl -sI  $H/api/public/projects     | head -n1   # 200

# Scripts served as scripts, at the root and at depth
curl -sI  $H/km-api.js               | head -n1   # 200
curl -s   $H/km-api.js               | head -c 40 # JS, not "<!DOCTYPE html>"
curl -sI  $H/brand/km-api.js         | head -n1   # 200 — depth rule
curl -sI  $H/brand/vantar/support.js | head -n1   # 200 — deeper depth rule
curl -sI  $H/brand/assets/logo-light.svg | head -n1  # 200
curl -sI  $H/assets/logo-light.svg   | head -n1   # 200 — root assets untouched

# Pages
curl -sI  $H/works        | head -n1   # 200
curl -sI  $H/reels        | head -n1   # 200
curl -sI  $H/privacy      | head -n1   # 200
curl -sI  $H/brand/vantar | head -n1   # 200
curl -sI  $H/admin/login  | head -n1   # 200
curl -sI  $H/nope         | head -n1   # 404, not 200
```

Then in a browser:

1. Landing → **Book a call**: calendar and time column render, times load, submit succeeds.
2. `/admin/login`: sign in with an address in `ADMIN_EMAILS`.
3. CRM → new project → type a name: the *saved* indicator settles and the field keeps what
   you typed.
4. Publish it, then open its public URL from the CRM link.
5. Resize to a phone width: the booking modal is a full-height sheet, and the process and
   team rows swipe.

## What the frontend expects from the API

The pages handle 401, 404, 409, 422 and 503 and show their own state for each. Points
where the frontend's expectations are easy to miss:

- `shots[].span` is 1–6 with a free `w`/`h` ratio per shot.
- Availability blocks are date **ranges**, not single dates.
- `/api/public/busy` feeds the booking modal's greyed-out slots; a 409 on submit means the
  slot went while the form was open, and the UI recovers by refreshing.
- Project responses should echo only server-owned fields (`id`, `slug`, `state`,
  timestamps) as authoritative — the CRM treats everything else as local until saved.
- `heroFocus` and `cardFocus` are focal-point strings (`"40% 25%"`) that must survive a
  PATCH and come back in the public payload. `HERO-FOCUS.md` has the detail.
- The public payload needs the hero image's pixel dimensions (`heroW` / `heroH`, or
  `assets.hero.w` / `.h`). Without them the brand case page cannot use the image's own
  ratio and falls back to cropping at 21:10.
