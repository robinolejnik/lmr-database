import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { formatCoords } from "../lib/format";

// Field names follow the legacy DB schema (German), per CLAUDE.md language
// rule. UI labels are translated to English; data values are shown as-is.
// legacy.antenne has no index on `name`, so PostGraphile doesn't expose
// NAME_ASC in its orderBy enum. NATURAL gives Postgres-default order — fine
// for a quick preview; add an explicit index in the legacy schema if a real
// sort is needed.
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
        funkanlage { rowId name }
        zuteilung { rowId fachschluessel }
      }
    }
  }
`;

export const Route = createFileRoute("/antennas")({
  component: function AntennasList() {
    const [{ data, fetching, error }] = useQuery({
      query: AntennasQuery,
      variables: { first: 50 },
    });
    const d: any = data;

    return (
      <Stack>
        <Group justify="space-between" align="flex-end">
          <Stack gap={0}>
            <Group gap="sm">
              <Title order={2}>Antennas</Title>
              <Badge color="gray" variant="light">legacy</Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Read-only view of the imported allocation registry.
            </Text>
          </Stack>
          {d?.antennes && (
            <Text size="sm" c="dimmed">
              {d.antennes.totalCount.toLocaleString()} total — showing first 50
            </Text>
          )}
        </Group>

        {fetching && <Loader size="sm" />}
        {error && <Alert color="red" title="Failed to load">{error.message}</Alert>}

        {d?.antennes && (
          <Table.ScrollContainer minWidth={720}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Location</Table.Th>
                  <Table.Th>Height (m)</Table.Th>
                  <Table.Th>Radio station</Table.Th>
                  <Table.Th>Allocation</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.antennes.nodes.map((a: any) => (
                  <Table.Tr key={a.rowId}>
                    <Table.Td>{a.name}</Table.Td>
                    <Table.Td>{formatCoords(a.lat, a.lon)}</Table.Td>
                    <Table.Td>{a.hoeheuebergrund ?? "—"}</Table.Td>
                    <Table.Td>{a.funkanlage?.name ?? "—"}</Table.Td>
                    <Table.Td>{a.zuteilung?.fachschluessel ?? "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    );
  },
});
