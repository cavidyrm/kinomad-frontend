# Image focal points (`heroFocus`, `cardFocus`)

Editor-chosen focal points for the two images the site crops, so a portrait or square
upload crops around the part that matters instead of dead centre:

| Field | Image | Cropped to | Appears on |
| --- | --- | --- | --- |
| `heroFocus` | Website case-study hero | 21:10 | `/website/<slug>` hero |
| `cardFocus` | 3D & motion card image | 2:3 | Works grid card |

**Both halves are done and live.** The CRM renders the crop previews, `km-api.js` sends
both fields on save and reads them back from the public payload, the two public pages
apply them, and the API stores and returns them. §1–§2 below are kept as the reference
spec for the contract, not as work outstanding.

---

## Status

Done, nothing to do:

- `Kinomad CRM.dc.html` — crop preview under the website hero (21:10) and the 3D/motion
  card (2:3): drag to set the focal point, a note reporting how much is cropped, and a
  **Center** reset. Built on one shared `_cropView(asset, field, ratio, label)`.
- `km-api.js` — sends `heroFocus` / `cardFocus` on project save (passed through as opaque
  strings, deliberately not parsed), and maps `heroFocus`, `cardFocus`, `heroW`, `heroH`
  out of the public payload.
- `Kinomad Website Page.dc.html` — real heroes render as `<img>` with
  `object-position:{{ c.heroFocus }}`; `image-slot` stays for records with no uploaded
  hero, which is what lets a design tool accept a dropped placeholder.
- `Kinomad Works.dc.html` — same two-branch treatment on the 3D card, with
  `object-position:{{ tp.cardFocus }}`.
- `Kinomad Brand Page.dc.html` — hero renders at `aspect-ratio:{{ c.heroRatio }}`, derived
  from `heroW`/`heroH`. Brand heroes are never cropped and have no focal point.

- `kinomad-backend` — `hero_focus` / `card_focus` columns (migration `003_focal_points`),
  both accepted on PATCH and returned in the admin and public payloads, malformed values
  stored as `NULL` rather than rejected. WebP now decodes natively so `assets.hero.w/h` is
  real; assets stored before that are measured once at startup.

Nothing outstanding. §1 and §2 below describe the contract as built.

---

## 1. Value format

Both fields are a CSS `background-position` / `object-position` pair: two percentages,
space separated, X then Y, each an integer 0–100 with a `%` suffix.

```
"50% 50%"   centre (default)
"40% 25%"   40% across, 25% down
```

- `0% 0%` is the top-left of the image, `100% 100%` the bottom-right.
- Absent, empty, or unparseable means centre. Never fail a request over it.

Treat it as an opaque string end to end. Do not normalise, round-trip through a struct of
two floats, or reformat it — both the CRM preview and the public pages parse exactly this
shape.

---

## 2. Backend

### 2.1 Store them

Two nullable text columns on the projects table (or the equivalent in your model):

```sql
ALTER TABLE projects ADD COLUMN hero_focus text;
ALTER TABLE projects ADD COLUMN card_focus text;
```

Nullable, no default. `NULL` means centre.

### 2.2 Accept them on update

Add `heroFocus` and `cardFocus` to whatever allow-list the project PATCH handler uses.
**This is the step that fails silently if missed** — the CRM will appear to save (the
autosave indicator settles, the preview looks right) and the value will be gone on reload.

The CRM sends them through the normal autosave, independently or together:

```
PATCH /api/projects/:id
{ "heroFocus": "40% 25%" }
```

Validation, if you validate at all — same pattern for both:

```
^(100|\d{1,2})% (100|\d{1,2})%$
```

On a non-matching value, prefer storing `NULL` over returning 422. These are cosmetic
fields; they should never block saving a project.

### 2.3 Return them

Include both in:

- the **admin** project response (GET one, GET list, and the PATCH/publish responses) —
  the CRM reads them back to restore the marker positions;
- the **public** project response used by the case-study and works pages.

Omit the key or send `null` when unset; do not substitute `"50% 50%"` server-side — the
frontend applies its own default.

### 2.4 Hero dimensions for the brand page

Separate from the focal points, and required for the brand case page to render an
uncropped hero: the public payload must carry the hero image's pixel size — `heroW` and
`heroH`, or `assets.hero.w` / `.h`, which `km-api.js` already maps. Without them every
brand project falls back to 21:10 and crops, which is the bug this replaced.

### 2.5 One caution on the PATCH response

The CRM merges only server-owned fields (`id`, `slug`, `state`, timestamps) from a save
response back into its local state; everything else it treats as local until the user
changes it. A focal point in the PATCH response is therefore ignored while the form is
open — deliberately, so a slow response cannot overwrite a drag in progress. Both are read
on load. No action needed; noted so the behaviour does not look like a bug.

### 2.6 Do not crop server-side

Keep storing the original upload. The focal point is presentational and re-editable;
baking the crop into the stored file makes it permanent and forces a re-upload to change.
If you later add derivative sizes for performance, generate them from the original and
keep the focal point as the positioning hint.

---

## 3. Keeping preview and page in step

The CRM's previews use `background-position` on a `background-size:cover` box; the pages
use `object-position` on an `object-fit:cover` image. These resolve identically for the
same percentage pair — that equivalence is what makes the previews trustworthy. If either
side ever changes to `contain`, or to a different aspect ratio, they diverge and the
preview stops predicting the page.

Each ratio is hard-coded in two places. Change them together:

| Ratio | CRM | Page |
| --- | --- | --- |
| 21:10 | `_cropView(asset('hero'), 'heroFocus', '21/10', '21:10')` | website hero wrapper |
| 2:3 | `_cropView(asset('card'), 'cardFocus', '2/3', '2:3')` | Works 3D card media |

The CRM's field labels ("Hero image · 21:10", "Card image · 2:3 portrait") quote the same
numbers and should be updated alongside.

---

## 4. Test

1. CRM → a draft **website** project → upload a tall portrait hero. The note under the
   preview reads something like `1200×1800 · full width, 71% of the height is cropped`.
2. Drag the focal point to the top. Wait for *saved*.
3. Reload and reopen the project — the marker is where you left it.
   *If it snapped back to centre, §2.2 was missed.*
4. Publish, open the public case page — the hero shows the top of the image, matching the
   preview.
5. Repeat on a **3D/motion** project's card image, checking the Works grid card.
6. A project whose images were never given focal points renders centred.
7. A **brand** project with a 16:9 hero shows uncropped at 16:9.
   *If it renders 21:10, §2.4 was missed.*
