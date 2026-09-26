import { Fragment } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

/** Handbook text as React elements: no HTML from the page body ever reaches the DOM. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="event-text handbook-text">
      {parseMarkdown(source).map((block, i) => {
        if (block.type === "heading") return block.level === 2 ? <h3 key={i}><Spans parts={block.content} /></h3> : <h4 key={i}><Spans parts={block.content} /></h4>;
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Spans parts={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <Spans parts={block.content} />
          </p>
        );
      })}
    </div>
  );
}

function Spans({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.type === "bold" ? (
          <strong key={i}>{part.text}</strong>
        ) : part.type === "link" ? (
          <a key={i} href={part.href} target={part.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
