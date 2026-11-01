# 🎁 Secret Santa

A free, private Secret Santa app that runs entirely in the browser and is hosted for free on **GitHub Pages**. There's no backend, no accounts and no tracking: every match travels inside the private link you send each person.

**Live site (after you enable Pages):** `https://<your-username>.github.io/secret-santa/`

## Features

**Organizing**
- Step-by-step setup: name, date & time, budget (26 currencies), location, a message for everyone
- Add people by typing, by pasting a whole list (emails are detected), or with a **sign-up link** where people add themselves along with their wishlist, sizes and notes
- Avatars, households, emails and phone numbers per person
- Autosave, undo for removals, multiple exchanges, **backup export/import**, and “copy for next year”

**Rules**
- Keep households apart, block any pair (one-way or both ways), and **avoid last year’s pairs**
- Optional **no two-way swaps** and **one big loop** (a single gift chain)
- Live feasibility check. If rules clash, you get a plain-English reason (via Hall’s theorem), e.g. *“Ann, Bob and Cat can only draw from Dan and Eve: 3 people for 2 spots.”*
- Shows how many valid draws exist and how many bits of randomness that is, and warns when matches might be guessable
- An interactive who-can-draw-whom grid

**Drawing & sending**
- Draws are **exactly uniform** over every valid assignment (crypto RNG + rejection sampling), with a randomized-search fallback for extremely tight rules
- A private link per person, sent by email, SMS, WhatsApp, the native share sheet, a QR code, or copy/paste, with an editable message template
- Sent-tracking with a progress bar; matches stay hidden from the organizer unless they choose to look
- **Draw fingerprint:** a SHA-256 Merkle commitment, so everyone can confirm their link came from the same draw
- Edited something after drawing? **Update links** keeps the same matches
- **Party mode** (pass one phone around, with screen wake lock) and **printable cards** (spoiler-free QR cards or fold-over slips)

**Revealing**
- Three reveal styles: gift box 🎁, scratch card 🪙 and envelope ✉️, plus confetti, a synthesized jingle and five color themes
- Recipient’s wishlist (links are clickable), notes, live countdown, add to calendar (.ics or Google), and budget-matched gift ideas

**Sealed mode 🔐 (end-to-end encrypted)**
- Participants sign up and choose a secret phrase. Their match is encrypted to a key only they can unlock, so **even the organizer can’t peek**, and sealed links are safe to share in a group chat.

**Extras**
- A gift idea generator with 140+ ideas, filterable by budget and interest
- A standalone shareable wishlist page
- Works offline and installs as an app (PWA); light/dark mode, snow, sound and reduced-motion settings
- Accessible: keyboard friendly, screen-reader labels, and it respects reduced motion

## Deploy to GitHub Pages

The site is plain static files in [`docs/`](docs/), with no build step.

**Option A: GitHub Actions (recommended, deploys only after tests pass)**
1. Merge this branch into `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main` (or re-run the **Test & deploy** workflow). The workflow runs unit tests and browser tests (Chromium, Firefox and WebKit), then publishes `docs/`.

Until step 2 is done, the deploy job is skipped with a notice instead of failing.

**Option B: Deploy from a branch**
Go to **Settings → Pages → Source: Deploy from a branch → `main` → `/docs`**. GitHub serves the folder as-is (`docs/.nojekyll` turns off Jekyll).

All paths are relative, so the site also works on a user site (`username.github.io`), a custom domain, or any static host.

## How the privacy works

- Everything after the `#` in a URL (the fragment) is **never sent to the server**. GitHub Pages only ever serves the same static files to everyone.
- **Regular links** contain the match DEFLATE-compressed and base64url-encoded. That's *encoded, not encrypted*: anyone holding a regular link can read it.
- **Sealed links** use Web Crypto only:
  - **Participant key:** ECDH P-256, generated in the participant's browser.
  - **Key wrapping:** the private key is wrapped with AES-256-GCM under a PBKDF2-HMAC-SHA256 key (600,000 iterations, random 128-bit salt, exchange id as AAD).
  - **Encrypting each match:** an ephemeral ECDH key → HKDF-SHA256 → AES-256-GCM, with the link's cleartext header as AAD.
  - **What the organizer keeps:** neither the match nor the leaf salt of sealed entries is stored, since the salt would let the organizer brute-force the leaf.
- **Draw fingerprint:** a Merkle tree over salted `(index, giver, recipient)` leaves, with RFC 6962-style domain separation. Each link embeds an inclusion proof that the reveal page verifies.
- **Hardening:**
  - A strict Content Security Policy (`script-src 'self'`, `style-src 'self'`, no inline code). The 404 page's two inline blocks are allowed by SHA-256 hash.
  - No third-party requests, no `innerHTML` (all text is rendered as text nodes), and `Referrer-Policy: no-referrer`.
  - The app refuses to run inside a frame.
  - Every decoded link field is length-capped and stripped of control/bidi characters.
  - Decompression is capped against compression bombs.

**Threat model & limits** (also on the in-app *How it works* page):
- Sealed mode protects against a *curious* organizer, not one who modifies the code: the organizer's browser briefly holds every match while encrypting them.
- Browser history keeps full URLs, fragments included.
- All GitHub Pages projects on one account share an origin (`username.github.io`), so they share `localStorage`.
- Generated secret phrases carry about 38.5 bits of entropy. Combined with 600k PBKDF2 rounds, that's about 5 months of high-end GPU time on average to brute-force one.

## Development

Requires Node 20+. There are no runtime dependencies.

```bash
npm start            # serve docs/ at http://localhost:8080/secret-santa/ (mimics GitHub Pages)
npm test             # unit tests: draw engine (incl. chi-square uniformity), codecs, crypto, Merkle, site integrity
npm run test:e2e     # browser tests (needs Playwright: npm i --no-save playwright && npx playwright install)
BROWSER=webkit npm run test:e2e
npm run build:sw     # regenerate the service worker's precache list after changing files in docs/
npm run icons        # re-render PNG icons from docs/icons/icon.svg
```

`npm test` fails if `docs/sw.js` is stale, if an import path or icon name is wrong, or if the 404 page's CSP hashes don't match its inline code, so these mistakes are caught before deploy.

### Layout

```
docs/                 the website (deployed as-is)
  index.html          app shell + CSP
  404.html            GitHub Pages 404, also recovers links whose “#” got lost
  sw.js               offline support (network-first, path-scoped caches)
  css/app.css         all styles (light/dark, event themes, print)
  js/core/            draw engine, link codecs, sealed-mode crypto, Merkle commitment, event model
  js/lib/             DOM, bytes, storage, formatting, ICS, linkify, …
  js/ui/ js/views/    components and pages
  js/vendor/          qrcode-generator (MIT) and a Lucide icon subset (ISC)
scripts/              dev server, service-worker builder, icon renderer
tests/unit/           node:test unit tests
tests/e2e/            Playwright end-to-end tests
```

## Third-party code

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, MIT license (see the header in `docs/js/vendor/qrcode.js`)
- [Lucide](https://lucide.dev) icons, ISC license (see the header in `docs/js/vendor/lucide-icons.js`)

No license has been chosen for this project's own code yet. Add a `LICENSE` file if you want others to reuse it.
