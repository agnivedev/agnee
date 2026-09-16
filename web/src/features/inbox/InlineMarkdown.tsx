import { Fragment, type ReactNode } from 'react';

/**
 * WhatsApp's little markup subset, rendered as React elements.
 *
 * The vanilla implementation escaped the text and assigned innerHTML. Building
 * elements instead means message bodies can never become markup, whatever a
 * customer types — the escaping step is not something we have to remember.
 */

type Rule = { pattern: RegExp; render: (inner: ReactNode, key: string, raw: string) => ReactNode };

// Trailing `.,!?)]"'` excluded from the match so a link at the end of a
// sentence ("cek https://foo.com/bar.") does not swallow the period into
// the href. Raw URL text renders as-is, not recursed through the other
// rules below — a stray `_` in a query string must not turn into italics.
const INLINE_RULES: Rule[] = [
  {
    pattern: /(https?:\/\/[^\s<]+[^\s<.,!?)\]"'])/,
    render: (_inner, key, raw) => (
      <a
        key={key}
        href={raw}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="text-[#1878cf] break-all underline"
      >
        {raw}
      </a>
    ),
  },
  { pattern: /\*\*([^*]+)\*\*/, render: (inner, key) => <strong key={key}>{inner}</strong> },
  { pattern: /\*([^*]+)\*/, render: (inner, key) => <strong key={key}>{inner}</strong> },
  { pattern: /__([^_]+)__/, render: (inner, key) => <strong key={key}>{inner}</strong> },
  { pattern: /_([^_]+)_/, render: (inner, key) => <em key={key}>{inner}</em> },
  {
    pattern: /`([^`]+)`/,
    render: (inner, key) => (
      <code key={key} className="rounded bg-ink/6 px-1 font-mono text-[.92em]">
        {inner}
      </code>
    ),
  },
];

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    return [
      ...renderInline(before, `${keyPrefix}b`),
      rule.render(renderInline(match[1], `${keyPrefix}i`), `${keyPrefix}m`, match[1]),
      ...renderInline(after, `${keyPrefix}a`),
    ];
  }
  return text ? [text] : [];
}

export function InlineMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, index) => {
        const heading = /^(#{1,3}) (.*)$/.exec(line);
        const bullet = /^- (.*)$/.exec(line);
        const key = `l${index}`;
        const content = renderInline(heading ? heading[2] : bullet ? bullet[1] : line, key);

        if (heading) {
          const level = heading[1].length;
          const className = 'm-0 font-semibold';
          if (level === 1) return <h1 key={key} className={`${className} text-[1.15em]`}>{content}</h1>;
          if (level === 2) return <h2 key={key} className={`${className} text-[1.08em]`}>{content}</h2>;
          return <h3 key={key} className={`${className} text-[1.02em]`}>{content}</h3>;
        }

        return (
          <Fragment key={key}>
            {index > 0 ? <br /> : null}
            {bullet ? '• ' : null}
            {content}
          </Fragment>
        );
      })}
    </>
  );
}
