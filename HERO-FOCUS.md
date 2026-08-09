# Image focal points (`heroFocus`, `cardFocus`)

Adds editor-chosen focal points for the two images the site crops, so a portrait or
square upload crops around the part that matters instead of dead centre:

| Field | Image | Cropped to | Appears on |
| --- | --- | --- | --- |
| `heroFocus` | Website case-study hero | 21:10 | `/website/<slug>` hero |
| `cardFocus` | 3D & motion card image | 2:3 | Works grid card |

The CRM side is already built and shipping. This document covers the two remaining
pieces: persisting the fields in the API, and honouring them on the public pages.

**Not in scope: the brand hero.** Brand case heroes are deliberately uncropped — they
render at the image's own ratio — so they have no focal point. See §5.

---

## 1. What already exists (no work needed)

`Kinomad CRM.dc.html` renders a crop preview under the relevant picker once an image is
uploaded: 21:10 under the website hero, 2:3 under the 3D/motion card. Dragging in the
preview sets a focal point, and the CRM writes it to the project record through the
normal autosave:

```
PATCH /api/projects/:id
{ "heroFocus": "40% 25%" }

PATCH /api/projects/:id
{ "cardFocus": "50% 20%" }
```

Both are independent and may arrive in the same or separate requests.

### Value format

Identical for both fields. A CSS `background-position` / `object-position` pair: two
percentages, space separated, X then Y, each an integer 0–100 with a `%` suffix.

```
"50% 50%"   centre (default)
"40% 25%"   40% across, 25% down
```

- `0% 0%` is the top-left of the image, `100% 100%` the bottom-right.
- Absent, empty, or unparseable means centre. Never fail a request over it.

Treat it as an opaque string end to end. Do not normalise, round-trip through a
struct of two floats, or reformat it — the frontend parses exactly this shape.

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
autosave indicator settles, the preview looks right) and the value will be gone on
reload.

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

Omit the key or send `null` when unset; do not substitute `"50% 50%"` server-side —
let the frontend apply its own default.

### 2.4 One caution on the PATCH response

The CRM merges only server-owned fields (`id`, `slug`, `state`, timestamps) from a
save response back into its local state; everything else it treats as local until the
user changes it. That means a focal point in the PATCH response is ignored while the
form is open — deliberately, so a slow response can't overwrite a drag in progress.
Both are read on load. No action needed; noted so the behaviour doesn't look like a bug.

### 2.5 Do not crop server-side

Keep storing the original upload. The focal point is presentational and re-editable;
baking the crop into the stored file makes it permanent and forces a re-upload to
change. If you later add derivative sizes for performance, generate them from the
original and keep the focal point as the positioning hint.

---

## 3. Frontend — website case hero (`heroFocus`)

In `Kinomad Website Page.dc.html`:

```html
<section data-screen-label="Website hero image" style="padding:0">
  <div style="position:relative;width:100%;aspect-ratio:21/10;background:var(--card)">
    <x-import component-from-global-scope="image-slot" from="./image-slot.js"
      id="{{ c.heroId }}" src="{{ c.heroSrc }}" shape="rect" radius="0"
      placeholder="{{ c.heroPh }}"
      style="position:absolute;inset:0;width:100%;height:100%"
      hint-size="100%,560px"></x-import>
  </div>
</section>
```

`image-slot` has no focal-point attribute and centre-crops. It is there so the design
tool can accept dropped placeholder images on a project with no real hero yet — keep
that path, and add a plain `<img>` for the case where a real hero exists.

### 3.1 Template

Replace the `<x-import>` line with two branches:

```html
    <sc-if value="{{ c.heroReal }}" hint-placeholder-val="{{ false }}">
      <img src="{{ c.heroSrc }}" alt="{{ c.heroPh }}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:{{ c.heroFocus }};display:block">
    </sc-if>
    <sc-if value="{{ c.heroSlot }}" hint-placeholder-val="{{ true }}">
      <x-import component-from-global-scope="image-slot" from="./image-slot.js"
        id="{{ c.heroId }}" src="{{ c.heroSrc }}" shape="rect" radius="0"
        placeholder="{{ c.heroPh }}"
        style="position:absolute;inset:0;width:100%;height:100%"
        hint-size="100%,560px"></x-import>
    </sc-if>
```

`object-position` in a `{{ }}` hole is correct here: it is a live per-record value, not
a static token.

### 3.2 Logic

Where the case record `c` is assembled in `renderVals()`, add three derived values.
`heroReal` must be true only for a hero that came from the API, so the built-in demo
records keep using `image-slot`:

```js
const fromApi = !!(rec && rec.assets && rec.assets.hero && rec.assets.hero.url);
c.heroReal  = fromApi;
c.heroSlot  = !fromApi;
c.heroFocus = (rec && rec.heroFocus) || '50% 50%';
```

Adjust the source of `rec` to match however that page currently maps an API project
(the demo fallbacks have no `assets`, so they fall to `heroSlot` naturally).

---

## 4. Frontend — 3D & motion card (`cardFocus`)

In `Kinomad Works.dc.html`, the 3D section's card media:

```html
<div onMouseMove="{{ parallaxMove }}" onMouseLeave="{{ parallaxLeave }}"
  style="position:relative;overflow:hidden;aspect-ratio:2/3;max-height:min(620px,calc(var(--vh,1svh) * 72));background:var(--card)">
```

Inside it, the image is mounted the same way as the hero. Apply the same two-branch
treatment, with `object-position:{{ tp.cardFocus }}`, and derive the values in
`_mapThree(c)` where each card record is built:

```js
const fromApi = !!(c && c.assets && c.assets.card && c.assets.card.url);
return {
  // …existing fields…
  cardReal:  fromApi,
  cardSlot:  !fromApi,
  cardFocus: (c && c.cardFocus) || '50% 50%',
};
```

Note the parallax handlers already transform this element on hover. `object-position`
composes with that transform without conflict — do not move the parallax onto the
`<img>`'s `object-position`.

---

## 5. Brand hero is not cropped

`Kinomad Brand Page.dc.html` renders its hero at the image's own ratio:

```html
<div style="position:relative;width:100%;aspect-ratio:{{ c.heroRatio }};background:var(--card)">
```

with

```js
const hw = c && c.heroW, hh = c && c.heroH;
c.heroRatio = (hw && hh) ? (hw + '/' + hh) : (c.heroRatio || '21/10');
```

For that to work on real projects, the **public project payload must include the hero
image's pixel dimensions** — `heroW` and `heroH`, or whatever the asset record already
carries (`assets.hero.w` / `.h`), in which case map them on the frontend instead. Without
them the page falls back to 21:10 and crops after all, which is the bug this replaced.

The brand form in the CRM shows no crop preview, by design.

---

## 6. Keep preview and page in step

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

## 7. Test

1. In the CRM, upload a tall portrait image as the hero of a draft **website** project.
   The note under the preview should read something like
   `1200×1800 · full width, 71% of the height is cropped`.
2. Drag the focal point to the top of the preview. Wait for *saved*.
3. Reload the CRM and reopen the project — the marker is where you left it.
   *If it snapped back to centre, step 2.2 was missed.*
4. Publish, open the public case page — the hero shows the top of the image, matching
   the preview.
5. Repeat 1–4 on a **3D/motion** project's card image, checking the Works grid card.
6. Open a project whose images were never given focal points — both render centred.
7. Upload a 16:9 hero to a **brand** project — the case page shows it uncropped at 16:9.
8. Open a demo/unpublished project in the design tool — the `image-slot` placeholders
   still accept a dropped image.
