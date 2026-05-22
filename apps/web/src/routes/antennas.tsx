import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";

// GraphQL field/type names (`antennes`, `funkanlage`, `zuteilung`) are German
// because they're auto-derived from the legacy DB schema. UI labels below are
// English per the language rule (see CLAUDE.md → Language rule).
const AntennasQuery = /* GraphQL */ `
  query Antennas($first: Int!) {
    antennes(first: $first) {
      totalCount
      nodes {
        rowId
        name
        lat
        lon
        hoeheuebergrund
        funkanlage {
          rowId
          name
        }
        zuteilung {
          rowId
          fachschluessel
        }
      }
    }
  }
`;

export const Route = createFileRoute("/antennas")({
  component: function AntennasList() {
    const [{ data, fetching, error }] = useQuery({
      query: AntennasQuery,
      variables: { first: 25 },
    });

    if (fetching) return <p>Loading…</p>;
    if (error) return <p style={{ color: "crimson" }}>Error: {error.message}</p>;
    if (!data) return null;

    return (
      <section>
        <p style={{ color: "#666" }}>
          {data.antennes.totalCount.toLocaleString()} antennas total — showing 25
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f4f4f4", textAlign: "left" }}>
              <th style={{ padding: "4px 8px" }}>Name</th>
              <th style={{ padding: "4px 8px" }}>Lat</th>
              <th style={{ padding: "4px 8px" }}>Lon</th>
              <th style={{ padding: "4px 8px" }}>Height (m)</th>
              <th style={{ padding: "4px 8px" }}>Radio station</th>
              <th style={{ padding: "4px 8px" }}>Allocation</th>
            </tr>
          </thead>
          <tbody>
            {data.antennes.nodes.map((a: any) => (
              <tr key={a.rowId} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: "4px 8px" }}>{a.name}</td>
                <td style={{ padding: "4px 8px" }}>{a.lat}</td>
                <td style={{ padding: "4px 8px" }}>{a.lon}</td>
                <td style={{ padding: "4px 8px" }}>{a.hoeheuebergrund}</td>
                <td style={{ padding: "4px 8px" }}>{a.funkanlage?.name}</td>
                <td style={{ padding: "4px 8px" }}>{a.zuteilung?.fachschluessel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  },
});
