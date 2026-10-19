# Kachó Kayente — pickup ordering site

Static one-page site for Kachó Kayente, a stuffed hot dog pop-up in Willemstad, Curaçao. Plain HTML, CSS and vanilla JavaScript: no build step, no dependencies.

**Prototype:** orders are not sent anywhere. The cart, pickup slots and confirmation are a demo until a form or backend is connected (see `submitOrder()` in `app.js`).

## Files

```
index.html     page markup, icon + illustration sprites
styles.css     design tokens, layout, scroll-motion styles
app.js         CONFIG, menu, ordering flow, scroll motion
assets/
  logo-mark.png   header logo (870×325)
  logo-full.png   footer logo with tagline (1044×429)
  mascot.png      walking mascot for the scroll band (520×439)
```

## Publish on GitHub Pages

1. Create a new repository on GitHub (public, or private on a paid plan).
2. Upload `index.html`, `styles.css`, `app.js`, `.nojekyll` and the `assets/` folder to the root of the repository.
3. Go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## Edit the details

Everything you'll change is at the top of `app.js`:

- `CONFIG` — event name, date, pickup address and hours, map link, WhatsApp number (digits with country code, e.g. `5999…`), Instagram handle, and switches:
  - `ORDER_STATUS`: `'open'`, `'preorder'`, `'closed'` or `'soldout'`
  - `SHOW_PROTOTYPE_BAR`, `SHOW_CATERING`, `DEMO_SOLD_OUT`
- `MENU` — names, ingredients, prices (currently demo prices) and `available` flags.

## Add photos

Drop JPGs into `assets/` with these exact names (lowercase). Each one replaces its placeholder automatically; any missing photo keeps the placeholder.

| File | Where it shows | Shape |
|---|---|---|
| `assets/hero.jpg` | Big image at the top | 5:4 landscape |
| `assets/story.jpg` | Maroon "What's inside counts" band | landscape or square |
| `assets/taco.jpg` | Taco Dog card + product sheet | 4:3 |
| `assets/bbq.jpg` | BBQ Dog card + product sheet | 4:3 |
| `assets/pizza.jpg` | Pizza Dog card + product sheet | 4:3 |

Keep each under ~500 KB (about 1600px wide is plenty). To swap the logos, replace `logo-mark.png`, `logo-full.png` or `mascot.png` with transparent PNGs of the same names.

After changing `styles.css` or `app.js`, bump the `?v=2` number on their links in `index.html` (to `?v=3`, …) so visitors' browsers load the new version.

## Test states

Add these to the URL (they don't save to the visitor's browser):

- `?status=closed` / `preorder` / `soldout`
- `?slots=full`
- `?outcome=fail`
- `?screen=cart` / `details` / `details-errors` / `review` / `confirm` / `failed` / `whatsapp`

## Preview locally

```bash
python3 -m http.server 4321
```

Then open http://localhost:4321.
