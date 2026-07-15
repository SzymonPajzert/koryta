import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const { html, url } = JSON.parse(trimmed);
    const dom = new JSDOM(html, { url: url || 'https://example.com' });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const result = {
      title: article?.title ?? null,
      published_time: article?.publishedTime ?? null,
      text_content: article?.textContent
        ? article.textContent.replace(/\s+/g, ' ').trim()
        : null,
    };
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e.message) }) + '\n');
  }
});
