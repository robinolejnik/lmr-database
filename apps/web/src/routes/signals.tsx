import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
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
import {
  formatAudit,
  formatBandwidthHz,
  formatFrequencyHz,
} from "../lib/format";

const SignalsQuery = /* GraphQL */ `
  query Signals {
    currentSignals(orderBy: FREQUENCY_HZ_ASC) {
      totalCount
      nodes {
        rowId
        name
        frequencyHz
        bandwidthHz
        mode { rowId code name }
        transmitter { rowId name }
        notes
        createdAt
        createdBy { displayName preferredUsername email }
      }
    }
    currentModes {
      nodes { rowId code name displayOrder }
    }
    currentTransmitters(orderBy: NAME_ASC) {
      nodes { rowId name }
    }
  }
`;

const CreateSignalMutation = /* GraphQL */ `
  mutation CreateSignal($input: CreateCurrentSignalInput!) {
    createCurrentSignal(input: $input) {
      currentSignal { rowId name }
    }
  }
`;

type FormValues = {
  name: string;
  modeId: string | null;
  frequencyMhz: number | "";
  bandwidthKhz: number | "";
  transmitterId: string | null;
  notes: string;
};

const empty: FormValues = {
  name: "",
  modeId: null,
  frequencyMhz: "",
  bandwidthKhz: "",
  transmitterId: null,
  notes: "",
};

export const Route = createFileRoute("/signals")({
  component: function SignalsPage() {
    const [{ data, fetching, error }, refetch] = useQuery({ query: SignalsQuery });
    const [{ fetching: saving }, createSignal] = useMutation(CreateSignalMutation);
    const [opened, { open, close }] = useDisclosure(false);
    const d: any = data;

    const modeOptions = (d?.currentModes?.nodes ?? [])
      .slice()
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((m: any) => ({
        value: m.rowId as string,
        label: `${m.code} — ${m.name}`,
      }));

    const transmitterOptions =
      (d?.currentTransmitters?.nodes ?? []).map((t: any) => ({
        value: t.rowId as string,
        label: t.name as string,
      }));

    const form = useForm<FormValues>({
      initialValues: empty,
      validate: {
        name: (v) => (v.trim() ? null : "Required"),
        modeId: (v) => (v ? null : "Select a mode"),
        frequencyMhz: (v) => (v !== "" && v > 0 ? null : "Frequency required (MHz, > 0)"),
        bandwidthKhz: (v) => (v === "" || v >= 0 ? null : "Bandwidth must be ≥ 0"),
      },
    });

    const onClose = () => {
      close();
      form.reset();
    };

    const handleSubmit = form.onSubmit(async (values) => {
      const result = await createSignal({
        input: {
          currentSignal: {
            name: values.name.trim(),
            modeId: values.modeId,
            // user inputs MHz/kHz for ergonomics; store as Hz integers
            frequencyHz: Math.round((values.frequencyMhz as number) * 1_000_000),
            bandwidthHz:
              values.bandwidthKhz === ""
                ? null
                : Math.round((values.bandwidthKhz as number) * 1_000),
            transmitterId: values.transmitterId,
            notes: values.notes.trim() || null,
          },
        },
      });
      if (result.error) {
        notifications.show({ color: "red", title: "Couldn't create signal", message: result.error.message });
        return;
      }
      notifications.show({
        color: "green",
        message: `Created “${result.data?.createCurrentSignal?.currentSignal?.name}”`,
      });
      onClose();
      refetch({ requestPolicy: "network-only" });
    });

    return (
      <Stack>
        <Group justify="space-between" align="flex-end">
          <Stack gap={0}>
            <Title order={2}>Signals</Title>
            <Text size="sm" c="dimmed">
              Persistent radio signals: frequency + mode, optionally linked to a transmitter.
            </Text>
          </Stack>
          <Group gap="md">
            {d?.currentSignals && (
              <Text size="sm" c="dimmed">
                {d.currentSignals.totalCount.toLocaleString()} total
              </Text>
            )}
            <Button onClick={open} disabled={!d?.currentModes}>New signal</Button>
          </Group>
        </Group>

        {fetching && !d && <Loader size="sm" />}
        {error && <Alert color="red" title="Failed to load">{error.message}</Alert>}

        {d?.currentSignals && d.currentSignals.nodes.length === 0 && (
          <Alert color="blue" variant="light">
            No signals yet. Click <strong>New signal</strong> to add the first one.
          </Alert>
        )}

        {d?.currentSignals && d.currentSignals.nodes.length > 0 && (
          <Table.ScrollContainer minWidth={780}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Frequency</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Bandwidth</Table.Th>
                  <Table.Th>Transmitter</Table.Th>
                  <Table.Th>Added</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.currentSignals.nodes.map((s: any) => (
                  <Table.Tr key={s.rowId}>
                    <Table.Td ff="monospace">{formatFrequencyHz(s.frequencyHz)}</Table.Td>
                    <Table.Td>
                      {s.mode ? <Badge variant="light">{s.mode.code}</Badge> : "—"}
                    </Table.Td>
                    <Table.Td fw={500}>{s.name}</Table.Td>
                    <Table.Td>{formatBandwidthHz(s.bandwidthHz)}</Table.Td>
                    <Table.Td c="dimmed">{s.transmitter?.name ?? "—"}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{formatAudit(s.createdAt, s.createdBy)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Modal opened={opened} onClose={onClose} title="New signal" size="md">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label="Name"
                placeholder="Taxi Berlin dispatch"
                required
                data-autofocus
                {...form.getInputProps("name")}
              />
              <Select
                label="Mode"
                placeholder="Pick one"
                required
                searchable
                data={modeOptions}
                {...form.getInputProps("modeId")}
              />
              <Group grow>
                <NumberInput
                  label="Frequency (MHz)"
                  placeholder="159.475"
                  decimalScale={6}
                  step={0.001}
                  required
                  {...form.getInputProps("frequencyMhz")}
                />
                <NumberInput
                  label="Bandwidth (kHz)"
                  placeholder="12.5"
                  decimalScale={3}
                  step={0.5}
                  {...form.getInputProps("bandwidthKhz")}
                />
              </Group>
              <Select
                label="Transmitter (optional)"
                placeholder={transmitterOptions.length ? "Link to a known transmitter" : "Add transmitters first to link them"}
                searchable
                clearable
                data={transmitterOptions}
                disabled={transmitterOptions.length === 0}
                {...form.getInputProps("transmitterId")}
              />
              <Textarea
                label="Notes"
                autosize
                minRows={2}
                maxRows={6}
                placeholder="CTCSS tone, talkgroup, observations…"
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
