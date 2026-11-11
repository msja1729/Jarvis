/** Replies are shown formatted (bold, lists, code, links), and can never inject HTML. */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../app/renderer/markdown.js';

describe('reply formatting', () => {
  it('formats the Markdown the team writes', () => {
    const html = renderMarkdown('Dry weather.\n\n**Morning:** cleanser, *then* `SPF 30`.\n\n- water\n- sleep\n\n1. one\n2. two\n\n## Next');
    expect(html).toBe(
      '<p>Dry weather.</p><p><strong>Morning:</strong> cleanser, <em>then</em> <code>SPF 30</code>.</p><ul><li>water</li><li>sleep</li></ul><ol><li>one</li><li>two</li></ol><h4>Next</h4>',
    );
  });

  it('keeps code blocks as they are', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2 && **x**;\n```')).toBe('<pre><code>const a = 1 &lt; 2 &amp;&amp; **x**;</code></pre>');
  });

  it('turns links into links to the browser, only http(s)', () => {
    expect(renderMarkdown('See [the guide](https://example.com/a?b=1&c=2).')).toBe(
      '<p>See <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noreferrer">the guide</a>.</p>',
    );
    expect(renderMarkdown('Go to https://example.com.')).toBe('<p>Go to <a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>.</p>');
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toMatch(/<a /);
  });

  it('never lets a reply inject HTML', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **<b>hi</b>** [a"b](https://x.y/"onmouseover=1)');
    expect(html).not.toMatch(/<img|<b>|"\s*onmouseover/);
    expect(html).toContain('&lt;img');
  });

  it('keeps single line breaks and ignores stray asterisks in maths', () => {
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
    expect(renderMarkdown('2 * 3 * 4 = 24')).toBe('<p>2 * 3 * 4 = 24</p>');
  });
});
