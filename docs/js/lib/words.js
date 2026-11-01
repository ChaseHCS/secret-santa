// 256 short, distinct, easy-to-type words for generated secret phrases.
// 4 words (8 bits each) + a number 10–99 (≈6.5 bits) ≈ 38.5 bits of entropy.
import { randomInt } from './random.js';

export const WORDS = [
  'acorn', 'alpine', 'amber', 'angel', 'apple', 'arctic', 'aurora', 'autumn',
  'badger', 'bakery', 'balsam', 'banjo', 'basket', 'beacon', 'bear', 'berry',
  'birch', 'biscuit', 'blanket', 'blizzard', 'bloom', 'bonbon', 'bonnet', 'boots',
  'bramble', 'brass', 'bright', 'brook', 'bubbly', 'bunny', 'butter', 'cabin',
  'candle', 'candy', 'canyon', 'caramel', 'carol', 'castle', 'cedar', 'cheer',
  'cherry', 'chestnut', 'chimney', 'cider', 'cinnamon', 'clover', 'cocoa', 'comet',
  'cookie', 'copper', 'coral', 'cosmic', 'cottage', 'cozy', 'cranberry', 'crisp',
  'crystal', 'cupcake', 'dancer', 'dazzle', 'delight', 'dolphin', 'donut', 'dove',
  'dream', 'drum', 'eagle', 'ember', 'emerald', 'evergreen', 'fable', 'falcon',
  'feast', 'fern', 'festive', 'fiddle', 'fig', 'firefly', 'flannel', 'flurry',
  'forest', 'fox', 'frost', 'fudge', 'galaxy', 'garland', 'gentle', 'ginger',
  'glacier', 'glitter', 'glow', 'golden', 'goose', 'grape', 'gravy', 'harbor',
  'harmony', 'hazel', 'hearth', 'heron', 'holly', 'honey', 'hoot', 'icicle',
  'igloo', 'iris', 'ivory', 'ivy', 'jasmine', 'jelly', 'jingle', 'jolly',
  'joyful', 'juniper', 'kettle', 'kindle', 'kitten', 'koala', 'lantern', 'lark',
  'laurel', 'lemon', 'lilac', 'linen', 'lively', 'llama', 'lucky', 'lullaby',
  'magic', 'maple', 'marble', 'marmalade', 'meadow', 'melody', 'merry', 'meteor',
  'midnight', 'mint', 'mistletoe', 'mitten', 'moose', 'muffin', 'nectar', 'nimble',
  'noble', 'nougat', 'nutmeg', 'oasis', 'ocean', 'olive', 'onyx', 'orange',
  'orbit', 'orchid', 'otter', 'owl', 'pajama', 'panda', 'parade', 'parcel',
  'peach', 'pebble', 'penguin', 'pepper', 'pine', 'pinecone', 'pixie', 'plum',
  'polar', 'popcorn', 'poppy', 'prancer', 'pretzel', 'pudding', 'puffin', 'quartz',
  'quill', 'quilt', 'radiant', 'raven', 'reindeer', 'ribbon', 'river', 'robin',
  'rocket', 'rosy', 'ruby', 'rudolph', 'saffron', 'sage', 'satin', 'scarf',
  'sequin', 'shimmer', 'silver', 'skate', 'sled', 'sleigh', 'snowball', 'snowy',
  'sparkle', 'sparrow', 'spice', 'sprinkle', 'spruce', 'starry', 'stocking', 'sugar',
  'summit', 'sunny', 'sweater', 'swift', 'syrup', 'tango', 'teacup', 'thistle',
  'thunder', 'tinsel', 'toasty', 'toffee', 'topaz', 'trumpet', 'tulip', 'tundra',
  'twinkle', 'umbrella', 'unicorn', 'valley', 'vanilla', 'velvet', 'violet', 'waffle',
  'walnut', 'walrus', 'warm', 'whisker', 'willow', 'winter', 'wish', 'wonder',
  'woolly', 'wreath', 'yarn', 'yeti', 'yodel', 'yule', 'zebra', 'zephyr',
  'zesty', 'zigzag', 'zinnia', 'zippy', 'blossom', 'breeze', 'cloud', 'daisy',
];

/** e.g. "jolly-reindeer-tinsel-cocoa-42" */
export function generatePassphrase(words = 4) {
  const parts = [];
  for (let i = 0; i < words; i++) parts.push(WORDS[randomInt(WORDS.length)]);
  parts.push(String(10 + randomInt(90)));
  return parts.join('-');
}

export const GENERATED_BITS = 4 * Math.log2(256) + Math.log2(90);

/**
 * Rough strength estimate for a custom phrase (bits). Deliberately conservative:
 * dictionary words from our list count 8 bits each, everything else uses a
 * character-class estimate with a penalty for repeats.
 */
const COMMON = [
  'password', 'passw0rd', 'christmas', 'xmas', 'santa', 'secret', 'qwerty', 'letmein', 'iloveyou',
  'admin', 'welcome', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'abc',
  'merry', 'holiday', 'present', 'gift', 'family', 'love', '1234', '0000', '1111', 'asdf',
];

export function estimateBits(phrase) {
  let p = String(phrase || '').toLowerCase();
  if (!p) return 0;
  let penalty = 0;
  for (const c of COMMON) {
    while (p.includes(c)) {
      p = p.replace(c, ' ');
      penalty += 3;
    }
  }
  p = p.replace(/(19|20)\d\d/g, () => {
    penalty += 3;
    return ' ';
  });
  const tokens = p.split(/[\s\-_.]+/).filter(Boolean);
  let bits = penalty;
  for (const t of tokens) {
    if (WORDS.includes(t)) {
      bits += 8;
      continue;
    }
    if (/^\d+$/.test(t)) {
      bits += Math.min(t.length, 6) * Math.log2(10);
      continue;
    }
    let pool = 0;
    if (/[a-z]/.test(t)) pool += 26;
    if (/\d/.test(t)) pool += 10;
    if (/[^a-z0-9]/.test(t)) pool += 20;
    const unique = new Set(t).size;
    bits += Math.log2(Math.max(pool, 2)) * Math.min(t.length, unique + 2) * 0.75;
  }
  return Math.round(bits);
}
