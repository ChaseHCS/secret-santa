import { h } from '../lib/dom.js';
import { DEFAULT_ITERATIONS } from '../core/seal.js';
import { GENERATED_BITS } from '../lib/words.js';
import { linkButton } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const section = (id, title, ...body) => h('section', { class: 'card prose', 'aria-labelledby': id }, h('h2', { id }, title), ...body);

export default function aboutView({ root }) {
  document.title = 'How it works & security · Secret Santa';
  const iters = DEFAULT_ITERATIONS.toLocaleString();
  root.append(
    h(
      'div',
      { class: 'container narrow page-pad stack-lg about' },
      h(
        'div',
        { class: 'page-head' },
        h('h1', 'How it works & security'),
        h('p', { class: 'lead' }, 'A static site with no backend: the whole app runs in your browser and every secret travels inside the links you send. Here’s exactly what that means, including the limits.'),
      ),
      h(
        'nav',
        { class: 'toc card', 'aria-label': 'On this page' },
        h(
          'ul',
          [
            ['links', 'What’s in a link'],
            ['modes', 'Regular vs. sealed mode'],
            ['crypto', 'Cryptography details'],
            ['fair', 'How the draw stays fair'],
            ['fingerprint', 'Draw fingerprints'],
            ['storage', 'What’s stored where'],
            ['limits', 'Limitations & threat model'],
            ['faq', 'FAQ'],
          ].map(([id, label]) => h('li', h('a', { href: `#/about`, onClick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); } }, label))),
        ),
      ),
      section(
        'links',
        'What’s in a link',
        h('p', 'When you draw names, each person gets a link like ', h('code', '…/secret-santa/#/r/AQEp3x…'), '. Everything after the ', h('code', '#'), ' is the URL ', h('em', 'fragment'), ', which browsers never send to the web server. GitHub Pages only ever serves the same static files to everyone; it never sees names, wishlists or matches.'),
        h('p', 'A regular link contains the exchange details, the person’s name, their match’s name and wishlist, and a short cryptographic proof (see fingerprints), all compressed with DEFLATE and base64url-encoded. Encoded, not encrypted: anyone who has a regular link can read the match inside it.'),
      ),
      section(
        'modes',
        'Regular vs. sealed mode',
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            { class: 'compare' },
            h('thead', h('tr', h('th', ''), h('th', { scope: 'col' }, 'Regular'), h('th', { scope: 'col' }, 'Sealed'))),
            h(
              'tbody',
              [
                ['Setup', 'Type names in', 'Everyone signs up and picks a secret phrase'],
                ['Who can read a link', 'Anyone holding it', 'Only the person who knows the phrase'],
                ['Can the organizer peek?', 'Yes, if they open someone’s link or use “Show all matches”', 'No. Matches are encrypted to participants, and the organizer’s device never stores them'],
                ['Safe to post all links in a group chat?', 'No', 'Yes (each link only opens with its owner’s phrase)'],
                ['Forgot the secret?', 'Nothing to forget', 'The organizer must draw again'],
                ['Party mode / printing', 'Yes', 'Yes (enter the phrase on the device)'],
              ].map(([a, b, c]) => h('tr', h('th', { scope: 'row' }, a), h('td', b), h('td', c))),
            ),
          ),
        ),
        h('p', { class: 'small muted' }, 'You can mix both: in sealed mode, people added by hand (without signing up) get regular links.'),
      ),
      section(
        'crypto',
        'Cryptography details',
        h('p', 'Everything uses the browser’s built-in Web Crypto API; there’s no third-party crypto code.'),
        h(
          'ul',
          h('li', h('strong', 'Randomness: '), h('code', 'crypto.getRandomValues'), ' with rejection sampling, so there’s no modulo bias.'),
          h('li', h('strong', 'Participant keys: '), 'ECDH on P-256, generated in the participant’s browser at sign-up.'),
          h('li', h('strong', 'Key wrapping: '), `the private key is encrypted with AES-256-GCM under a key derived from the secret phrase with PBKDF2-HMAC-SHA256, ${iters} iterations and a random 128-bit salt. The exchange id is bound in as associated data.`),
          h('li', h('strong', 'Sealing matches: '), 'ECIES-style: a fresh ephemeral P-256 key per link → ECDH shared secret → HKDF-SHA256 (salted with both public keys) → AES-256-GCM. The link’s readable header (names, exchange id, public key) is authenticated as associated data, so it can’t be tampered with.'),
          h('li', h('strong', 'Secret phrases: '), `generated phrases are 4 words from a 256-word list plus a number from 10–99 (≈${GENERATED_BITS.toFixed(1)} bits). Combined with ${iters} PBKDF2 rounds, brute-forcing one would keep a high-end GPU busy for about 5 months on average (about 10 to cover every possibility). Phrases are case-insensitive and treat spaces and dashes the same.`),
          h('li', h('strong', 'Remember on this device: '), 'stores the unwrapped private key in IndexedDB as a non-extractable CryptoKey: usable by this site, never exportable as raw bytes.'),
        ),
      ),
      section(
        'fair',
        'How the draw stays fair',
        h('p', 'Names are drawn by rejection sampling: build a uniformly random arrangement, keep it only if every rule holds (nobody draws themselves, households, exclusions, no swaps, one loop…), otherwise try again. Conditioning a uniform distribution on validity gives a result that is exactly uniform over every valid draw, so no pairing is more likely than any other.'),
        h('p', 'If your rules are so tight that random tries keep failing, the app falls back to a randomized search (still random and valid, just not provably uniform) and tells you so on the Draw screen. The Rules step shows how many valid draws exist and how many bits of randomness that is.'),
        h('p', 'If rules can’t be satisfied at all, you get a plain-English reason. It’s found with bipartite matching and Hall’s theorem, e.g. “Ann, Bob and Cat can only draw from Dan and Eve: 3 people for 2 spots.”'),
      ),
      section(
        'fingerprint',
        'Draw fingerprints',
        h('p', 'Each draw commits to every match with a SHA-256 Merkle tree over salted (position, giver, recipient) leaves. Every link carries the tree’s root and a short inclusion proof for its own leaf, and the reveal page verifies it.'),
        h('p', 'The root is shown as a fingerprint like 🎄 🦊 ☕ 🎲 · 7F3A-91C2. If everyone in the group sees the same fingerprint, all links came from the same draw. That catches mix-ups such as some people getting links from an old draw. The 128-bit salts mean the proofs reveal nothing about other people’s matches.'),
        h('p', { class: 'small muted' }, 'What it doesn’t prove: that the committed draw itself is a valid derangement. That would require revealing other matches.'),
      ),
      section(
        'storage',
        'What’s stored where',
        h(
          'ul',
          h('li', h('strong', 'Organizer’s browser (localStorage): '), 'exchanges, participants, rules and the generated links. For sealed participants, only the encrypted link is stored, never their match or the salt that could be used to guess it.'),
          h('li', h('strong', 'Participant’s browser: '), 'nothing, unless they choose “remember on this device” (a non-extractable key in IndexedDB) or sign up (a note that they joined).'),
          h('li', h('strong', 'Servers: '), 'none. No analytics, no cookies, no third-party scripts, fonts or images. A strict Content Security Policy enforces it.'),
        ),
      ),
      section(
        'limits',
        'Limitations & threat model',
        h(
          'ul',
          h('li', 'Regular links are only as private as the channel you send them over. Anyone who gets the link can read it.'),
          h('li', 'Browser history and sync keep visited URLs, fragments included. On a shared computer, use a private window.'),
          h('li', 'In sealed mode, the organizer’s browser briefly knows every match while drawing (it has to, in order to encrypt them) and then discards them. A malicious organizer who modifies the code could keep them. Sealed mode protects against a curious organizer, not a hostile one with dev tools.'),
          h('li', 'With very tight rules, or only a few sealed people in a mostly regular exchange, matches can sometimes be deduced by elimination. The Rules step warns when there are very few possible draws.'),
          h('li', 'Secret phrases are only as strong as their entropy. The organizer and anyone holding a sealed link could try to guess it offline. Use the generated phrase.'),
          h('li', 'GitHub Pages sites for the same account share one origin (username.github.io), so other pages you host there could read this site’s local storage.'),
          h('li', 'Very long wishlists make long links, and some SMS apps truncate them. Email, chat apps and QR codes handle them fine.'),
        ),
      ),
      section(
        'faq',
        'FAQ',
        h('h3', 'Someone lost their link. What now?'),
        h('p', 'Open the exchange on the device you created it on, go to “Draw & send”, and send it again. Links never expire.'),
        h('h3', 'Can I fix a typo after drawing?'),
        h('p', 'Yes. For regular links, “Update links” keeps the same matches and regenerates the links. Sealed links can’t be regenerated without the matches, so you’d draw again.'),
        h('h3', 'Can I use it on another device?'),
        h('p', 'Export a backup from the exchange’s “More” menu, then import it on the other device’s home page.'),
        h('h3', 'Does it work offline?'),
        h('p', 'Yes. After your first visit, the app is cached, and you can install it from your browser’s menu (“Add to Home Screen” / “Install app”).'),
        h('h3', 'How many people can join?'),
        h('p', 'Up to 300 per exchange.'),
      ),
      h('p', { class: 'center' }, linkButton('Start an exchange', '#/new', { variant: 'primary', size: 'lg', iconName: 'sparkles' })),
      h('p', { class: 'center small muted' }, icon('code', { size: 14 }), ' The full source is public: read every line, or host your own copy on GitHub Pages.'),
    ),
  );
}
