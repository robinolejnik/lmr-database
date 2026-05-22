import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Anchor,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";

const StatsQuery = /* GraphQL */ `
  query DashboardStats {
    signals: currentSignals { totalCount }
    receivers: currentReceivers { totalCount }
    transmitters: currentTransmitters { totalCount }
    receptions: currentReceptions { totalCount }
    antennas: antennes { totalCount }
    funkanlagen: funkanlages { totalCount }
    zuteilungen: zuteilungs { totalCount }
  }
`;

type StatCardProps = {
  to?: string;
  label: string;
  value: number | undefined;
  hint?: string;
  loading?: boolean;
};

function StatCard({ to, label, value, hint, loading }: StatCardProps) {
  const inner = (
    <Card withBorder padding="md" radius="md" h="100%">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
        <Text size="xl" fw={700} lh={1}>
          {loading ? "…" : value?.toLocaleString() ?? "—"}
        </Text>
        {hint && <Text size="xs" c="dimmed">{hint}</Text>}
      </Stack>
    </Card>
  );
  return to ? (
    <Anchor component={Link} to={to} underline="never" c="inherit">{inner}</Anchor>
  ) : (
    inner
  );
}

export const Route = createFileRoute("/")({
  component: function Home() {
    const [{ data, fetching }] = useQuery({ query: StatsQuery });
    const d: any = data;

    return (
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>Frequency database</Title>
          <Text c="dimmed" maw={720}>
            Signals, receivers, transmitters, and direction finding — plus a
            read-only window into the imported allocation registry. Use the nav
            on the left to jump in.
          </Text>
        </Stack>

        <Stack gap="xs">
          <Title order={4}>Live data</Title>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <StatCard to="/signals"      label="Signals"      value={d?.signals?.totalCount}      loading={fetching} />
            <StatCard to="/receivers"    label="Receivers"    value={d?.receivers?.totalCount}    loading={fetching} />
            <StatCard to="/transmitters" label="Transmitters" value={d?.transmitters?.totalCount} loading={fetching} />
            <StatCard                    label="Receptions"   value={d?.receptions?.totalCount}   loading={fetching} hint="observations" />
          </SimpleGrid>
        </Stack>

        <Stack gap="xs">
          <Title order={4}>Legacy (read-only)</Title>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
            <StatCard to="/antennas" label="Antennas"      value={d?.antennas?.totalCount}    loading={fetching} />
            <StatCard                label="Radio stations" value={d?.funkanlagen?.totalCount} loading={fetching} hint="funkanlagen" />
            <StatCard                label="Allocations"    value={d?.zuteilungen?.totalCount} loading={fetching} hint="zuteilungen" />
          </SimpleGrid>
        </Stack>

        <Group justify="flex-end">
          <Text size="xs" c="dimmed">
            Schema explorer:{" "}
            <Anchor href="http://localhost:5050/graphiql" target="_blank" rel="noreferrer">
              GraphiQL
            </Anchor>
          </Text>
        </Group>
      </Stack>
    );
  },
});
