import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <section>
      <p>
        Frequency database — signals, receivers, transmitters, and a read-only
        window into the allocation registry. Pick a section above to start
        exploring.
      </p>
      <p>
        GraphiQL is at{" "}
        <a href="http://localhost:5050/graphiql" target="_blank" rel="noreferrer">
          http://localhost:5050/graphiql
        </a>
        .
      </p>
    </section>
  ),
});
