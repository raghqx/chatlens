// Deterministic fixture generator: seeded LCG, no Math.random, so goldens are stable.
// Timestamps advance monotonically within and across days, as real exports do.
import { writeFileSync } from 'node:fs';

function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const pad = (n) => String(n).padStart(2, '0');

const LINES = [
  'ok sounds good', 'deadline moved to friday', 'can you review the PR when free',
  'lets sync at 4', 'shipping the release now', 'the build is red again',
  'haha true', 'kal milte hai', 'kya scene hai', 'sending the doc',
  'see https://docs.example.com/spec/v2', 'yes please', 'no idea honestly',
  'that worked, thanks', 'on my way', 'running 10 min late', 'done and merged',
  'the metrics look off', 'good catch', 'lets park it for now',
];
const EMOJI = ['', ' 😂', ' 👍', ' 🎉', ' 🙏', ' 😅', ''];
const MEDIA = ['<Media omitted>', 'image omitted', 'sticker omitted'];

function fmt(d, format, dateOrder) {
  const day = pad(d.getDate()), mon = pad(d.getMonth() + 1), yr = d.getFullYear();
  const date = dateOrder === 'month-first' ? `${mon}/${day}/${yr}` : `${day}/${mon}/${yr}`;
  if (format === 'ios') {
    const h = d.getHours();
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    // U+202F narrow no-break space before AM/PM, as modern WhatsApp emits.
    return `${date}, ${h12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
  }
  return `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generate({ seed, people, startYear, startMonth, startDay, format, dateOrder, count }) {
  const r = lcg(seed);
  const out = [];
  // Cursor only ever moves forward.
  let cursor = new Date(startYear, startMonth - 1, startDay, 8, 0, 0);

  out.push(format === 'ios'
    ? `[${fmt(cursor, format, dateOrder)}] Messages and calls are end-to-end encrypted.`
    : `${fmt(cursor, format, dateOrder)} - Messages and calls are end-to-end encrypted.`);

  let made = 0;
  while (made < count) {
    // Jump to the next active day, skipping some entirely to create silences.
    const skip = 1 + (r() < 0.2 ? 1 + Math.floor(r() * 4) : 0);
    const startHour = r() < 0.6 ? 20 + Math.floor(r() * 3) : 9 + Math.floor(r() * 8);
    cursor = new Date(
      cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + skip,
      startHour, Math.floor(r() * 40), Math.floor(r() * 60),
    );

    const burst = 2 + Math.floor(r() * 8);
    for (let i = 0; i < burst && made < count; i++) {
      const who = pick(r, people);
      const text = r() < 0.06 ? pick(r, MEDIA) : pick(r, LINES) + pick(r, EMOJI);
      const stamp = fmt(cursor, format, dateOrder);
      out.push(format === 'ios' ? `[${stamp}] ${who}: ${text}` : `${stamp} - ${who}: ${text}`);
      made++;
      // Advance 1-9 minutes; the Date constructor rolls hours and days for us.
      cursor = new Date(cursor.getTime() + (60 + Math.floor(r() * 480)) * 1000);
    }
  }
  return out.join('\n') + '\n';
}

const fixtures = {
  'ios-two-person.txt': generate({ seed: 7, people: ['Aarav', 'Meera'], startYear: 2024, startMonth: 3, startDay: 4, format: 'ios', dateOrder: 'day-first', count: 900 }),
  'android-group.txt': generate({ seed: 21, people: ['Rohit', 'Priya', 'Dev', 'Sana'], startYear: 2024, startMonth: 6, startDay: 2, format: 'android', dateOrder: 'day-first', count: 700 }),
  'us-format.txt': generate({ seed: 99, people: ['Alex', 'Sam'], startYear: 2025, startMonth: 1, startDay: 6, format: 'ios', dateOrder: 'month-first', count: 400 }),
};

for (const [name, body] of Object.entries(fixtures)) {
  writeFileSync(`evals/fixtures/${name}`, body, 'utf8');
  console.log(name, (body.split('\n').length - 1) + ' lines');
}
