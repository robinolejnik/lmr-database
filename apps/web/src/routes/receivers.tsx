import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { formatAudit, formatCoords } from "../lib/format";

const ReceiversQuery = /* GraphQL */ `
  query Receivers {
    currentReceivers(orderBy: NAME_ASC) {
      totalCount
      nodes {
        rowId
        name
        kind
        lat
        lon
        antenna
        notes
        createdAt
        createdBy { displayName preferredUsername email }
      }
    }
  }
`;

const CreateReceiverMutation = /* GraphQL */ `
  mutation CreateReceiver($input: CreateCurrentReceiverInput!) {
    createCurrentReceiver(input: $input) {
      currentReceiver { rowId name }
    }
  }
`;

type FormValues = {
  name: string;
  kind: string;
  lat: number | "";
  lon: number | "";
  antenna: string;
  notes: string;
};

const empty: FormValues = { name: "", kind: "", lat: "", lon: "", antenna: "", notes: "" };

export const Route = createFileRoute("/receivers")({
  component: function ReceiversPage() {
    const [{ data, fetching, error }, refetch] = useQuery({ query: ReceiversQuery });
    const [{ fetching: saving }, createReceiver] = useMutation(CreateReceiverMutation);
    const [opened, { open, close }] = useDisclosure(false);
    const d: any = data;

    const form = useForm<FormValues>({
      initialValues: empty,
      validate: {
        name: (v) => (v.trim() ? null : "Required"),
        lat: (v) => (v === "" || (v >= -90  && v <= 90)  ? null : "Latitude must be between -90 and 90"),
        lon: (v) => (v === "" || (v >= -180 && v <= 180) ? null : "Longitude must be between -180 and 180"),
      },
    });

    const onClose = () => {
      close();
      form.reset();
    };

    const handleSubmit = form.onSubmit(async (values) => {
      const result = await createReceiver({
        input: {
          currentReceiver: {
            name: values.name.trim(),
            kind: values.kind.trim() || null,
            lat: values.lat === "" ? null : values.lat,
            lon: values.lon === "" ? null : values.lon,
            antenna: values.antenna.trim() || null,
            notes: values.notes.trim() || null,
          },
        },
      });
      if (result.error) {
        notifications.show({ color: "red", title: "Couldn't create receiver", message: result.error.message });
        return;
      }
      notifications.show({
        color: "green",
        message: `Created “${result.data?.createCurrentReceiver?.currentReceiver?.name}”`,
      });
      onClose();
      refetch({ requestPolicy: "network-only" });
    });

    return (
      <Stack>
        <Group justify="space-between" align="flex-end">
          <Stack gap={0}>
            <Title order={2}>Receivers</Title>
            <Text size="sm" c="dimmed">
              SDRs, scanners, handhelds — wherever you hear signals from.
            </Text>
          </Stack>
          <Group gap="md">
            {d?.currentReceivers && (
              <Text size="sm" c="dimmed">
                {d.currentReceivers.totalCount.toLocaleString()} total
              </Text>
            )}
            <Button onClick={open}>New receiver</Button>
          </Group>
        </Group>

        {fetching && !d && <Loader size="sm" />}
        {error && <Alert color="red" title="Failed to load">{error.message}</Alert>}

        {d?.currentReceivers && d.currentReceivers.nodes.length === 0 && (
          <Alert color="blue" variant="light">
            No receivers yet. Click <strong>New receiver</strong> to add the first one.
          </Alert>
        )}

        {d?.currentReceivers && d.currentReceivers.nodes.length > 0 && (
          <Table.ScrollContainer minWidth={720}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Location</Table.Th>
                  <Table.Th>Antenna</Table.Th>
                  <Table.Th>Notes</Table.Th>
                  <Table.Th>Added</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.currentReceivers.nodes.map((r: any) => (
                  <Table.Tr key={r.rowId}>
                    <Table.Td fw={500}>{r.name}</Table.Td>
                    <Table.Td>{r.kind ?? "—"}</Table.Td>
                    <Table.Td>{formatCoords(r.lat, r.lon)}</Table.Td>
                    <Table.Td>{r.antenna ?? "—"}</Table.Td>
                    <Table.Td c="dimmed">{r.notes ?? "—"}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{formatAudit(r.createdAt, r.createdBy)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Modal opened={opened} onClose={onClose} title="New receiver" size="md">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label="Name"
                placeholder="Berlin Mitte SDR"
                required
                data-autofocus
                {...form.getInputProps("name")}
              />
              <TextInput
                label="Kind"
                placeholder="SDR, scanner, handheld…"
                {...form.getInputProps("kind")}
              />
              <Group grow>
                <NumberInput
                  label="Latitude"
                  placeholder="52.52000"
                  decimalScale={6}
                  step={0.0001}
                  {...form.getInputProps("lat")}
                />
                <NumberInput
                  label="Longitude"
                  placeholder="13.40500"
                  decimalScale={6}
                  step={0.0001}
                  {...form.getInputProps("lon")}
                />
              </Group>
              <TextInput
                label="Antenna"
                placeholder="discone, vertical, log-periodic…"
                {...form.getInputProps("antenna")}
              />
              <Textarea
                label="Notes"
                autosize
                minRows={2}
                maxRows={6}
                {...form.getInputProps("notes")}
              />
              <Group justify="flex-end" mt="sm">
                <Button variant="default" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button type="submit" loading={saving}>Create</Button>
              </Group>
            </Stack>
          </form>
        </Modal>
      </Stack>
    );
  },
});
