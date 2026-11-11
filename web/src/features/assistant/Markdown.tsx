import { Fragment, useMemo } from 'react';
import { parseMarkdown, type Inline } from './parseMarkdown';

/**
 * Renders the assistant's light markdown (see parseMarkdown.ts). Every leaf is
 * a React text node, so nothing the model writes is ever treated as HTML.
 */

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === 'text' ? (
          <Fragment key={i}>{n.text}</Fragment>
        ) : n.type === 'code' ? (
          <code key={i}>{n.text}</code>
        ) : (
          <strong key={i}>
            <Inlines nodes={n.children} />
          </strong>
        ),
      )}
    </>
  );
}

function Lines({ lines }: { lines: Inline[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inlines nodes={line} />
        </Fragment>
      ))}
    </>
  );
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      {blocks.map((b, i) => {
        if (b.type === 'ul') {
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} start={b.start}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {b.strong ? (
              <strong>
                <Lines lines={b.lines} />
              </strong>
            ) : (
              <Lines lines={b.lines} />
            )}
          </p>
        );
      })}
    </div>
  );
}
