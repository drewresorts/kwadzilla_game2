# Kwadzilla — The Biggest Lizard Breaks Out

A playable Shopify splash page. It's a *Rampage*-style arcade game: a giant
lizard comes ashore on an island built entirely out of prisons, climbs the
walls, pulls the buildings apart floor by floor, and gets everybody out.

Break a barred window and somebody walks free. The score that counts is the one
marked **FREED**.

Zero dependencies, zero network requests, one canvas. All art is drawn in code
(including the 5×7 bitmap font), all sound is synthesised with WebAudio, so
there are no images, fonts, or audio files to host.

---

## Two ways to use this

This repo is **a complete Shopify theme** — Shopify's
[Horizon](https://github.com/Shopify/horizon), the current flagship theme, with
the Kwadzilla coming-soon page and game built on top. So you can either:

- **[Upload the whole repo as a theme](#uploading-as-a-theme)**, or
- **[Copy the parts you want into a theme you already have](#installing-on-horizon)** —
  the Kwadzilla files are self-contained and drop into Horizon, Dawn, or
  anything else OS 2.0.

## Files

The game's own files, which are the ones to copy if you're taking the
drop-in route:

```
assets/kwadzilla-game.js           the whole game (~87 KB unminified)
assets/kwadzilla-game.css          splash page + arcade cabinet styles

blocks/kwadzilla-game.liquid       theme block — Horizon & other block themes
sections/kwadzilla-arcade.liquid   theme-block section to compose it in
templates/page.kwadzilla-horizon.json   page template for the above

sections/kwadzilla-game.liquid     all-in-one section — Dawn & older OS 2.0
templates/page.kwadzilla.json      page template for the above

assets/kwadzilla-splash.js         the coming-soon page (WebGL)
assets/kwadzilla-splash.css        splash styles + no-WebGL fallback
sections/kwadzilla-coming-soon.liquid   section wrapping the above
templates/password.json            the coming-soon page, wired up
templates/page.coming-soon.json    the same thing as an ordinary page

index.html                         the coming-soon page
game.html                          standalone game preview
```

Everything else — `layout/`, `config/`, `locales/`, `snippets/`, and the rest
of `sections/`, `blocks/`, `templates/` and `assets/` — is Horizon, and is
what makes the repo a theme rather than a pile of parts. See
[Credits](#credits).

`index.html` and `game.html` are plain-HTML local previews, not theme files.
They're listed in `.shopifyignore` so they never get pushed to a store.

## Uploading as a theme

With the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli):

```bash
shopify theme check
shopify theme dev        # preview against a dev store
shopify theme push -u    # push as an unpublished theme
```

Or upload it through the admin without the CLI — zip the repo and use
**Online Store → Themes → Add theme → Upload zip file**:

```bash
git archive --format=zip -o kwadzilla-theme.zip HEAD
```

The theme's name and author live in `config/settings_schema.json` under
`theme_info` — currently both `Kwadzilla`. Change them before you ship if you
want something else in the admin.

Once it's uploaded, both halves are already wired up.

**The coming-soon page** is the password template, so turning on
**Online Store → Preferences → Restrict access** is all it takes — visitors
get the lizard, and the *Enter using password* link still gets you in. To put
it on an ordinary URL instead, create a page in **Online Store → Pages** and
give it the **coming-soon** template.

**The game** goes on a page with the **kwadzilla-horizon** template (theme
blocks) or **kwadzilla** (all-in-one). Both ship with copy filled in.

## Installing on Horizon

Horizon is built on [theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks),
so the game ships as one, and slots in anywhere Horizon accepts blocks.

1. Copy `assets/kwadzilla-game.js` and `assets/kwadzilla-game.css` into
   `assets/`.
2. Copy `blocks/kwadzilla-game.liquid` into `blocks/`.
3. In the theme editor, **Add block → Kwadzilla game** — inside any section
   that takes theme blocks. Use Horizon's own heading and text blocks around it
   for the copy.

Optionally also copy `sections/kwadzilla-arcade.liquid` into `sections/` for a
ready-made arcade-night canvas that accepts any theme or app block, and
`templates/page.kwadzilla-horizon.json` into `templates/` for a whole page
wired up already (**Online Store → Pages**, template **kwadzilla-horizon**).

The block's **Backdrop** setting decides how it meets the page:

| Backdrop | Use when |
| --- | --- |
| `None` | The surrounding section already has the look you want. |
| `Arcade night` | You want the cabinet as a self-contained dark panel. |
| `Theme palette` | You want it to follow the theme's own page colours. |

On `None` and `Theme palette` the buttons borrow the surrounding text colour,
so they stay readable on a light background.

You can place more than one on a page; each instance runs independently.

## Dawn and older OS 2.0 themes

Themes without theme blocks use the all-in-one section instead, which carries
the headline, copy, feature grid and footnote itself.

1. Copy the two files in `assets/` as above.
2. Copy `sections/kwadzilla-game.liquid` into `sections/`.
3. Either:
   - **Page template** — copy `templates/page.kwadzilla.json` into `templates/`,
     create a page in **Online Store → Pages**, and pick the **kwadzilla**
     template; or
   - **Any page** — in the theme editor, **Add section → Kwadzilla game**.

## Either way

Push it with `shopify theme push`, as in [Uploading as a
theme](#uploading-as-a-theme).

### The theme palette backdrop

`sections/kwadzilla-arcade.liquid` and the game block both offer a **Theme
palette** backdrop, which drops the arcade styling and takes the theme's own
page colours (`--color-background` and `--color-foreground`) instead. Use it
when the game should read as part of the page rather than as a panel dropped
onto it.

### Settings

Everything is editable in the theme editor without touching code. The block
exposes layout, buttons, reward, accent colours and sound; the all-in-one
section adds eyebrow, heading, subheading, intro copy, the footnote, and up to
six "feature" blocks.

**Reward:** set a discount code and a score threshold. Clear the threshold and
the game-over screen reveals the code with a copy button; miss it and it shows
the target instead. Leave the code blank to turn the reward off entirely.

> Create the discount itself in **Discounts** first — the game only reveals a
> code, it doesn't create one.

**Sound:** off until the visitor interacts with the page (browser autoplay
rules), and the toggle is remembered in `localStorage`.

## Local preview

The splash and the game are plain HTML, so they need no Shopify tooling:

```bash
python3 -m http.server 8000
# http://localhost:8000/          the coming-soon page
# http://localhost:8000/game.html the game
```

To preview them the way a shopper would — inside the theme, with the header,
footer and theme settings — use `shopify theme dev` against a dev store
instead.

## The coming-soon page

While the game is in development, the coming-soon page is the front door and
the game lives at `game.html`. Nothing on the splash links to the game.

It's a monitor lizard on a white seamless backdrop, lit like a studio shot.
There is no model file: the animal is generated as geometry at load, skinned
to a bone chain, and rendered in WebGL2.

- **The animal.** A spine of 90 bones swept into rings, with the girth,
  superellipse cross-section and surface displacement authored against real
  proportions — a 1.6 m monitor with a 17 cm head, a trunk wider than it is
  tall and a tail that is the other way round. Brow ridges, eye sockets, the
  jaw line, nostrils, the ear disc, a loose throat and a keeled tail all come
  from the same displacement function. Four sprawled limbs, twenty toes, twenty
  claws, two eyes with lids that actually close, and a forked tongue.
- **The skin.** A tiling relief map is baked once into a framebuffer at
  startup and sampled triplanar off the rest pose, so the scales never stretch
  or seam however hard the animal bends. Markings are procedural: rows of pale
  ocelli across the back, bands down the tail, a barred jaw, a cream underside.
- **The studio.** A three-light rig on a white cyclorama, with the backdrop lit
  harder than the subject the way a real seamless is. Contact shadow and
  ambient occlusion are integrated analytically against a couple of dozen
  spheres that track the animal — with a source this soft that lands closer
  than a shadow map would.
- **The framing.** The camera solves for itself: it takes the animal's bounds,
  picks a presentation angle from the aspect ratio, and iterates distance and
  aim until the subject fills the frame properly. A phone in portrait gets the
  animal turned towards the lens rather than a cropped tail.

**What the visitor controls is its attention, and nothing else.** The head and
eyes follow the cursor. Each eye aims itself, covering whatever the neck did
not, clamped to what an eye can physically do. On a phone the same thing is
driven by the gyroscope, so tilting the handset keeps the animal looking back
at you.

Everything else it does on its own: breathing, throat pumping, blinks that
sometimes double, tongue flicks in bursts of one to three, a slow travelling
wave down the tail, weight shifting between the feet, the occasional re-planted
foot, and a rare full-body stretch.

Still zero dependencies and zero network requests. If WebGL2 is missing or
JavaScript is off, a soft studio floor sweep takes over; the words are real DOM
either way, so screen readers and crawlers always get them.

`prefers-reduced-motion` damps the idle behaviour to a fraction but keeps the
gaze, since that is a direct response to the visitor's own input. Render scale
drops automatically if frames get expensive, and the whole thing pauses when
the tab is hidden or the page scrolls away.

### The custom font

The wordmark reads from `--kwad-font-display`. Upload a `.woff2` to `assets/`
and name it in the section's **Typeface** setting; the `@font-face` is written
for you and nothing else needs touching. Outside Shopify, uncomment the block
at the top of `index.html`.

The wordmark is already wired for animation. Every character is wrapped in its
own `<span class="kwad-soon__ch">` with `--i` set to its index and `--n` to the
total, the original string is kept alongside for screen readers, and
`.kwad-soon` gains `.is-ready` on the first rendered frame. That's a per-letter
stagger handle and a start signal; what ships now is a single plain settle,
which is meant to be replaced once the real face lands. See the *wordmark
animation hooks* block at the bottom of `assets/kwadzilla-splash.css`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `←` `→` / `A` `D` | D-pad |
| Climb up / down | `↑` `↓` / `W` `S` | D-pad |
| Smash | `Space` / `J` | SMASH |
| Jump | `Z` / `X` | JUMP |
| Rage | `Shift` / `K` | RAGE |
| Pause | `Esc` / `P` | ⏸ button |

Fill the RAGE meter by smashing. Cashing it in gives a few seconds of
invulnerability, and holding smash during it breathes fire.

**Getting around.** Jump height is variable — tap for a hop (~22px), hold for a
full jump (~67px). A second jump in mid-air takes you to ~120px, two and a half
times Kwadzilla's own height. Jumping while clinging to a wall kicks off it
sideways with height to spare, and you keep a mid-air jump afterwards, so you
can chain kicks between two facilities to gain altitude fast.

## How the demolition works

Each facility is a grid of 8×8 destructible cells. A punch clears cells inside
a radius; when a floor drops below about a third of its structure it gives way
and everything above it settles down one row, so the building visibly sinks as
you gut it. Once ~60% of the structure is gone the rest can't hold itself up and
the whole thing comes down.

Cells flagged as lit windows hold someone. Destroying one releases them; they
drop to the street, cheer, and run for the shoreline. They're only counted once
they're clear of the island.

Buildings render into their own offscreen canvas and only re-render when
damaged, which is what keeps a few thousand cells at a steady 60 fps.

## What's shooting at you

Riot vans, helicopters, rooftop turrets, jets, and a gunship mini-boss that
shows up once you've flattened half a sector.

Helicopters telegraph every shot: the belly light blinks red and a dotted tracer
paints the target for about half a second before they fire, so a shot is always
something you can walk out of. They hold station well above head height rather
than parking on top of you, leave roughly four seconds between attacks, and go
down in two punches.

Measured with helicopters as the only threat and a stationary player who never
dodges, that's 25% less incoming damage per minute than before — and a player
who actually uses the telegraph gets far more than that.

## Hooks for analytics

The mount element dispatches bubbling events:

```js
document.addEventListener('kwadzilla:gameover', function (e) {
  // e.detail => { score, freed, level, best }
});
// also: kwadzilla:start { level }, kwadzilla:levelclear { level, score, freed, bonus }
```

And exposes read-only state:

```js
document.querySelector('[data-kwadzilla]').__kwad.getState();
// { phase, score, best, lives, level, freed, standing, hp, x, y, mode }
```

## Accessibility and performance

- Real focusable buttons and links for every menu; the canvas is keyboard
  operable and only captures keys while focused, so it never eats page scroll.
- `prefers-reduced-motion` cuts screen shake, particle counts and the scanline
  overlay.
- Pauses itself when the tab is hidden or the game scrolls out of view
  (`IntersectionObserver`), so it isn't burning CPU further down a long page.
- Fixed 60 Hz timestep with a frame-time cap, independent of display refresh
  rate.
- 480×270 backing store scaled with `image-rendering: pixelated` — the canvas
  cost is the same on a phone as on a 5K display.

## A note on the setting

Kwadzilla is arcade fiction. Every facility, tower, sign and logo in the game
was invented for the game — no real place, company or person is depicted.

## Credits

The theme scaffolding is Shopify's [Horizon](https://github.com/Shopify/horizon)
(v4.1.3) — the flagship theme Shopify ships as the default — copied in
unmodified apart from the `theme_info` name and author, and the password
template, which now points at the coming-soon section. It's MIT-licensed; see
`LICENSE.md`, which covers that scaffolding rather than the game.

Note the licence limits use to themes that integrate with Shopify, which is
exactly what this is.

The game, the splash, and everything under the `kwadzilla-*` names are
original work.
