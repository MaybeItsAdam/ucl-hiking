/**
 * What a tab shows between being tapped and its page arriving. Without it the
 * app would sit on the old page until the server answered, which on a phone
 * connection reads as the tap not having registered.
 */
export function PageSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">Loading…</p>
      <ul className="skeleton-list" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <span className="skeleton-lines">
              <span className="skeleton" />
              <span className="skeleton" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
