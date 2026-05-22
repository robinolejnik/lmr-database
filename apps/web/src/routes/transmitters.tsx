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

const TransmittersQuery = /* GraphQL */ `
  query Transmitters {
    currentTransmitters(orderBy: NAME_ASC) {
      totalCount
      nodes {
        rowId
        name
        lat
        lon
        towerDescription
        antennaDescription
        legacyFunkanlageNameSnapshot
        notes
        createdAt
        createdBy { displayName preferredUsername email }
      }
    }
  }
`;

const CreateTransmitterMutation = /* GraphQL */ `
  mutation CreateTransmitter($input: CreateCurrentTransmitterInput!) {
    createCurrentTransmitter(input: $input) {
      currentTransmitter { rowId name }
    }
  }
`;

type FormValues = {
  name: string;
  lat: number | "";
  lon: number | "";
  towerDescription: string;
  antennaDescription: string;
  notes: string;
};

const empty: FormValues = {
  name: "",
  lat: "",
  lon: "",
  towerDescription: "",
  antennaDescription: "",
  notes: "",
};

export const Route = createFileRoute("/transmitters")({
  component: function TransmittersPage() {
    const [{ data, fetching, error }, refetch] = useQuery({ query: TransmittersQuery });
    const [{ fetching: saving }, createTransmitter] = useMutation(CreateTransmitterMutation);
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
      const result = await createTransmitter({
        input: {
          currentTransmitter: {
            name: values.name.trim(),
            lat: values.lat === "" ? null : values.lat,
            lon: values.lon === "" ? null : values.lon,
            towerDescription: values.towerDescription.trim() || null,
            antennaDescription: values.antennaDescription.trim() || null,
            notes: values.notes.trim() || null,
          },
        },
      });
      if (result.error) {
        notifications.show({ color: "red", title: "Couldn't create transmitter", message: result.error.message });
        return;
      }
      notifications.show({
        color: "green",
        message: `Created “${result.data?.createCurrentTransmitter?.currentTransmitter?.name}”`,
      });
      onClose();
      refetch({ requestPolicy: "network-only" });
    });

    return (
      <Stack>
        <Group justify="space-between" align="flex-end">
          <Stack gap={0}>
            <Title order={2}>Transmitters</Title>
            <Text size="sm" c="dimmed">
              Physical signal sources — towers, sites, repeaters.
            </Text>
          </Stack>
          <Group gap="md">
            {d?.currentTransmitters && (
              <Text size="sm" c="dimmed">
                {d.currentTransmitters.totalCount.toLocaleString()} total
              </Text>
            )}
            <Button onClick={open}>New transmitter</Button>
          </Group>
        </Group>

        {fetching && !d && <Loader size="sm" />}
        {error && <Alert color="red" title="Failed to load">{error.message}</Alert>}

        {d?.currentTransmitters && d.currentTransmitters.nodes.length === 0 && (
          <Alert color="blue" variant="light">
            No transmitters yet. Click <strong>New transmitter</strong> to add one.
          </Alert>
        )}

        {d?.currentTransmitters && d.currentTransmitters.nodes.length > 0 && (
          <Table.ScrollContainer minWidth={720}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Location</Table.Th>
                  <Table.Th>Tower</Table.Th>
                  <Table.Th>Antenna</Table.Th>
                  <Table.Th>Legacy link</Table.Th>
                  <Table.Th>Added</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.currentTransmitters.nodes.map((t: any) => (
                  <Table.Tr key={t.rowId}>
                    <Table.Td fw={500}>{t.name}</Table.Td>
                    <Table.Td>{formatCoords(t.lat, t.lon)}</Table.Td>
                    <Table.Td c="dimmed">{t.towerDescription ?? "—"}</Table.Td>
                    <Table.Td c="dimmed">{t.antennaDescription ?? "—"}</Table.Td>
                    <Table.Td c="dimmed">{t.legacyFunkanlageNameSnapshot ?? "—"}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{formatAudit(t.createdAt, t.createdBy)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Modal opened={opened} onClose={onClose} title="New transmitter" size="md">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label="Name"
                placeholder="Berliner Fernsehturm"
                required
                data-autofocus
                {...form.getInputProps("name")}
              />
              <Group grow>
                <NumberInput
                  label="Latitude"
                  placeholder="52.52078"
                  decimalScale={6}
                  step={0.0001}
                  {...form.getInputProps("lat")}
                />
                <NumberInput
                  label="Longitude"
                  placeholder="13.40923"
                  decimalScale={6}
                  step={0.0001}
                  {...form.getInputProps("lon")}
                />
              </Group>
              <TextInput
                label="Tower"
                placeholder="368 m TV tower, lattice mast on the roof, …"
                {...form.getInputProps("towerDescription")}
              />
              <TextInput
                label="Antenna"
                placeholder="omni VHF/UHF colinear, dish array, …"
                {...form.getInputProps("antennaDescription")}
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
