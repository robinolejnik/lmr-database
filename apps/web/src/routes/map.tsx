import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import dayjs from "dayjs";
import {
  LEGACY_PIN_IMAGE_IDS,
  MapCanvas,
  type MapBearing,
  type MapPoint,
  type MapReceptionPoint,
} from "../components/MapCanvas";
import {
  BASE_LAYERS,
  DEFAULT_BASE_LAYER,
  type BaseLayerId,
} from "../lib/mapStyles";
import { formatFrequencyHz } from "../lib/format";

// connection-filter rejects null literals inside filter objects. So the
// filters are built dynamically and only included when at least one bound
// is set; queries take the entire CurrentBearingFilter as a variable.
const MapDataQuery = /* GraphQL */ `
  query MapData($bearingFilter: CurrentBearingFilter) {
    receivers: currentReceivers {
      nodes { rowId name lat lon }
    }
    transmitters: currentTransmitters {
      nodes { rowId name lat lon }
    }
    modes: currentModes {
      nodes { rowId code name displayOrder }
    }
    signals: currentSignals(orderBy: NAME_ASC) {
      nodes {
        rowId
        name
        frequencyHz
        modeId
        mode { rowId code name }
      }
    }
    bearings: currentBearings(orderBy: OBSERVED_AT_DESC, filter: $bearingFilter) {
      totalCount
      nodes {
        rowId
        signalId
        receiverId
        observedAt
        azimuthDeg
        uncertaintyDeg
        rayGeojson
        wedgeGeojson
        signal { rowId name modeId mode { code } }
        receiver { rowId name lat lon }
      }
    }
  }
`;

const ReceptionsHeatmapQuery = /* GraphQL */ `
  query ReceptionsHeatmap($receptionFilter: CurrentReceptionFilter) {
    receptions: currentReceptions(filter: $receptionFilter) {
      nodes {
        rowId
        snrDb
        receiver { rowId lat lon }
        signal { rowId modeId }
      }
    }
  }
`;

const LegacyAntennaeQuery = /* GraphQL */ `
  query LegacyAntennaeInBox($filter: AntenneFilter!) {
    antennes(first: 100000, filter: $filter) {
      totalCount
      nodes {
        rowId
        name
        lat
        lon
        zuteilung { rowId statecodename befristung }
      }
    }
  }
`;

const LegacyServiceSegmentsQuery = /* GraphQL */ `
  query LegacyServiceSegments {
    currentLegacyServiceSegments {
      nodes
    }
  }
`;

const CreateBearingMutation = /* GraphQL */ `
  mutation CreateBearing($input: CreateCurrentBearingInput!) {
    createCurrentBearing(input: $input) {
      currentBearing { rowId }
    }
  }
`;

const LegacyAntennaDetailQuery = /* GraphQL */ `
  query LegacyAntennaDetail($id: UUID!) {
    antenne(rowId: $id) {
      rowId
      name
      lat
      lon
      artname
      hoeheuebergrund
      hoeheuebermeeresspiegel
      azimut
      polarisationname
      gewinn gewinneinheitname
      senderausgangsleistung senderausgangsleistungeinheitname
      strahlungsleistung strahlungsleistungeinheitname
      ortsbeschreibung
      funkanlage {
        rowId
        name
        kategoriename
        artname
        adresses(first: 5) {
          nodes { rowId strasse postleitzahl ort ortsbeschreibung }
        }
        zuordnungfrequenzfunkanlages(first: 50) {
          totalCount
          nodes {
            rowId
            name
            frequenzpaarauswahlname
            frequenz {
              rowId
              name
              frequenz1 frequenz1Einheitname
              frequenz2 frequenz2Einheitname
              kanal
              betriebsarten
              sendearten
              modulationsverfahrenname
              kanalbandbreite kanalbandbreiteeinheitname
              systemcodes
            }
          }
        }
      }
      zuteilung {
        rowId
        fachschluessel
        zuteilungsinhabername
        verwendungszweck
        dienstsegmentname
        funkversorgungsgebiet
        rufnamefunknetz
        ausstellung
        wirksam
        befristung
        beendigung
        beendigungsgrundname
        statecodename
        statuscodename
        frequenzs(first: 200) {
          totalCount
          nodes {
            rowId
            name
            frequenz1 frequenz1Einheitname
            frequenz2 frequenz2Einheitname
            kanal
            betriebsarten
            sendearten
            modulationsverfahrenname
            kanalbandbreite kanalbandbreiteeinheitname
            systemcodes
          }
        }
      }
    }
  }
`;

type BearingFormValues = {
  signalId: string | null;
  receiverId: string | null;
  observedAt: Date | null;
  azimuthDeg: number | "";
  uncertaintyDeg: number | "";
  notes: string;
};

const emptyBearing: BearingFormValues = {
  signalId: null,
  receiverId: null,
  observedAt: new Date(),
  azimuthDeg: "",
  uncertaintyDeg: "",
  notes: "",
};

export const Route = createFileRoute("/map")({
  component: MapPage,
});

function MapPage() {
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>(DEFAULT_BASE_LAYER);
  const [signalFilter, setSignalFilter] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(
    dayjs().subtract(30, "day").startOf("day").toDate()
  );
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showReceptions, setShowReceptions] = useState(false);
  const [showLegacyAntennae, setShowLegacyAntennae] = useState(false);
  const [legacyBbox, setLegacyBbox] = useState<{ minLat: number; maxLat: number; minLon: number; maxLon: number } | null>(null);
  const [selectedAntennaId, setSelectedAntennaId] = useState<string | null>(null);
  // Legacy-overlay filters (only applied when showLegacyAntennae is on).
  const [legacyServiceSegments, setLegacyServiceSegments] = useState<string[]>([]);
  const [legacyStates, setLegacyStates] = useState<string[]>(["Aktiv", "Inaktiv"]);
  // Kept as raw string so mid-decimal input ("0.", "144.") survives Mantine's
  // re-render; parsed in legacyFilter when building the GraphQL query.
  const [legacyFreqMinMhz, setLegacyFreqMinMhz] = useState<string>("");
  const [legacyFreqMaxMhz, setLegacyFreqMaxMhz] = useState<string>("");

  const navigate = useNavigate();

  const bearingFilter = useMemo(() => {
    const observedAt: Record<string, string> = {};
    if (dateFrom) observedAt.greaterThanOrEqualTo = dateFrom.toISOString();
    if (dateTo)   observedAt.lessThanOrEqualTo    = dateTo.toISOString();
    return Object.keys(observedAt).length ? { observedAt } : undefined;
  }, [dateFrom, dateTo]);

  const receptionFilter = useMemo(() => {
    const heardAt: Record<string, string> = {};
    if (dateFrom) heardAt.greaterThanOrEqualTo = dateFrom.toISOString();
    if (dateTo)   heardAt.lessThanOrEqualTo    = dateTo.toISOString();
    return Object.keys(heardAt).length ? { heardAt } : undefined;
  }, [dateFrom, dateTo]);

  const [{ data, fetching, error }, refetchMap] = useQuery({
    query: MapDataQuery,
    variables: { bearingFilter },
  });
  const d: any = data;

  const [{ data: receptionData, fetching: receptionsFetching }] = useQuery({
    query: ReceptionsHeatmapQuery,
    variables: { receptionFilter },
    pause: !showReceptions,
  });
  const rd: any = receptionData;

  const legacyFilter = useMemo(() => {
    const filter: Record<string, any> = {};
    if (legacyBbox) {
      filter.lat = { greaterThan: legacyBbox.minLat, lessThan: legacyBbox.maxLat };
      filter.lon = { greaterThan: legacyBbox.minLon, lessThan: legacyBbox.maxLon };
    }
    const zuteilung: Record<string, any> = {};
    if (legacyServiceSegments.length > 0) {
      zuteilung.dienstsegmentname = { in: legacyServiceSegments };
    }
    // Only apply state filter when not "both selected" (which equals no filter).
    if (legacyStates.length === 1) {
      zuteilung.statecodename = { equalTo: legacyStates[0] };
    }
    // Frequency bounds. User types MHz; the DB exposes unit-normalized
    // `frequenz1Hz` / `frequenz2Hz` columns so MHz/GHz/etc. compare on the
    // same scale. Match either side of a duplex pair.
    const parseMhz = (s: string): number | null => {
      if (s.trim() === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const minMhz = parseMhz(legacyFreqMinMhz);
    const maxMhz = parseMhz(legacyFreqMaxMhz);
    if (minMhz != null || maxMhz != null) {
      const bound = (col: string) => {
        const c: Record<string, number> = {};
        if (minMhz != null) c.greaterThanOrEqualTo = minMhz * 1_000_000;
        if (maxMhz != null) c.lessThanOrEqualTo = maxMhz * 1_000_000;
        return { [col]: c };
      };
      zuteilung.frequenzs = { some: { or: [bound("frequenz1Hz"), bound("frequenz2Hz")] } };
    }
    if (Object.keys(zuteilung).length > 0) {
      filter.zuteilung = zuteilung;
    }
    return filter;
  }, [legacyBbox, legacyServiceSegments, legacyStates, legacyFreqMinMhz, legacyFreqMaxMhz]);

  const [{ data: legacyData, fetching: legacyFetching }] = useQuery({
    query: LegacyAntennaeQuery,
    variables: { filter: legacyFilter },
    pause: !showLegacyAntennae || !legacyBbox,
  });
  const ld: any = legacyData;

  const [{ data: serviceSegmentsData }] = useQuery({
    query: LegacyServiceSegmentsQuery,
    pause: !showLegacyAntennae,
  });
  const serviceSegmentOptions = ((serviceSegmentsData as any)?.currentLegacyServiceSegments?.nodes ?? [])
    .filter((s: unknown): s is string => typeof s === "string")
    .map((s: string) => ({ value: s, label: s }));

  const [{ data: antennaDetailData, fetching: antennaDetailFetching, error: antennaDetailError }] = useQuery({
    query: LegacyAntennaDetailQuery,
    variables: { id: selectedAntennaId ?? "" },
    pause: !selectedAntennaId,
  });
  const ad: any = antennaDetailData;

  const [{ fetching: saving }, createBearing] = useMutation(CreateBearingMutation);
  const [bearingModalOpened, { open: openBearingModal, close: closeBearingModal }] = useDisclosure(false);

  const form = useForm<BearingFormValues>({
    initialValues: { ...emptyBearing, signalId: signalFilter },
    validate: {
      signalId:    (v) => (v ? null : "Pick a signal"),
      receiverId:  (v) => (v ? null : "Pick a receiver"),
      observedAt:  (v) => (v ? null : "Required"),
      azimuthDeg:  (v) => (v !== "" && v >= 0 && v < 360 ? null : "0–359.9°"),
      uncertaintyDeg: (v) => (v === "" || (v >= 0 && v <= 180) ? null : "0–180°"),
    },
  });

  const onCloseBearing = () => {
    closeBearingModal();
    form.reset();
  };

  const handleSubmitBearing = form.onSubmit(async (values) => {
    const result = await createBearing({
      input: {
        currentBearing: {
          signalId: values.signalId!,
          receiverId: values.receiverId!,
          observedAt: values.observedAt!.toISOString(),
          azimuthDeg: values.azimuthDeg as number,
          uncertaintyDeg: values.uncertaintyDeg === "" ? null : (values.uncertaintyDeg as number),
          notes: values.notes.trim() || null,
        },
      },
    });
    if (result.error) {
      notifications.show({
        color: "red",
        title: "Couldn't save bearing",
        message: result.error.message,
      });
      return;
    }
    notifications.show({ color: "green", message: "Bearing recorded" });
    onCloseBearing();
    refetchMap({ requestPolicy: "network-only" });
  });

  // Filter signals -> mode list options
  const allSignals: any[] = d?.signals?.nodes ?? [];
  const filteredSignals = modeFilter
    ? allSignals.filter((s) => s.modeId === modeFilter)
    : allSignals;

  const signalOptions = filteredSignals.map((s) => ({
    value: s.rowId as string,
    label: `${s.name} — ${formatFrequencyHz(s.frequencyHz)}`,
  }));
  const modeOptions = (d?.modes?.nodes ?? [])
    .slice()
    .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((m: any) => ({ value: m.rowId as string, label: `${m.code} — ${m.name}` }));
  const receiverOptions = (d?.receivers?.nodes ?? [])
    .filter((r: any) => r.lat != null && r.lon != null)
    .map((r: any) => ({ value: r.rowId as string, label: r.name as string }));

  // Apply signal/mode filters to bearings
  const visibleBearings: MapBearing[] = useMemo(() => {
    const rows = (d?.bearings?.nodes ?? []) as any[];
    return rows
      .filter((b) => !signalFilter || b.signalId === signalFilter)
      .filter((b) => !modeFilter   || b.signal?.modeId === modeFilter)
      .map((b) => ({
        id: b.rowId,
        signalId: b.signalId,
        signalName: b.signal?.name ?? "(unknown signal)",
        receiverName: b.receiver?.name ?? "(unknown receiver)",
        observedAt: b.observedAt,
        azimuthDeg: Number(b.azimuthDeg),
        uncertaintyDeg: b.uncertaintyDeg == null ? null : Number(b.uncertaintyDeg),
        ray:   b.rayGeojson   ?? null,
        wedge: b.wedgeGeojson ?? null,
      }));
  }, [d?.bearings?.nodes, signalFilter, modeFilter]);

  const receivers: MapPoint[] = useMemo(
    () =>
      (d?.receivers?.nodes ?? [])
        .filter((r: any) => r.lat != null && r.lon != null)
        .map((r: any) => ({ id: r.rowId, lat: Number(r.lat), lon: Number(r.lon), name: r.name })),
    [d?.receivers?.nodes]
  );

  const transmitters: MapPoint[] = useMemo(
    () =>
      (d?.transmitters?.nodes ?? [])
        .filter((t: any) => t.lat != null && t.lon != null)
        .map((t: any) => ({ id: t.rowId, lat: Number(t.lat), lon: Number(t.lon), name: t.name })),
    [d?.transmitters?.nodes]
  );

  const receptions: MapReceptionPoint[] = useMemo(() => {
    if (!showReceptions) return [];
    const nodes = (rd?.receptions?.nodes ?? []) as any[];
    return nodes
      .filter((r) => r.receiver?.lat != null && r.receiver?.lon != null)
      .filter((r) => !signalFilter || r.signal?.rowId === signalFilter)
      .filter((r) => !modeFilter   || r.signal?.modeId === modeFilter)
      .map((r) => ({
        id: r.rowId,
        lat: Number(r.receiver.lat),
        lon: Number(r.receiver.lon),
        weight: r.snrDb == null ? 0.5 : Math.max(0.1, Math.min(1, Number(r.snrDb) / 30)),
      }));
  }, [rd?.receptions?.nodes, showReceptions, signalFilter, modeFilter]);

  const legacyAntennae: MapPoint[] = useMemo(() => {
    if (!showLegacyAntennae) return [];
    const nodes = (ld?.antennes?.nodes ?? []) as any[];
    const nowMs = Date.now();
    return nodes
      .filter((a) => a.lat != null && a.lon != null)
      .map((a) => ({
        id: a.rowId,
        lat: Number(a.lat),
        lon: Number(a.lon),
        name: a.name,
        pinId: pinIdForAllocation(a.zuteilung, nowMs),
      }));
  }, [ld?.antennes?.nodes, showLegacyAntennae]);

  return (
    <Box
      style={{
        margin: "calc(-1 * var(--app-shell-padding))",
        height: "calc(100dvh - var(--app-shell-header-height, 56px))",
        display: "grid",
        gridTemplateColumns: "minmax(260px, 320px) 1fr",
        gap: 0,
        overflow: "hidden",
      }}
    >
      <Paper withBorder radius={0} style={{ overflow: "hidden", borderLeft: "none", borderTop: "none", borderBottom: "none" }}>
        <ScrollArea h="100%" type="auto">
          <Stack p="md" gap="md">
            <Stack gap={4}>
              <Title order={3} m={0}>Map</Title>
              <Text size="sm" c="dimmed">
                Receivers, transmitters and direction-finding bearings.
              </Text>
            </Stack>

            <Divider label="Base map" labelPosition="left" />
            <SegmentedControl
              value={baseLayer}
              onChange={(v) => setBaseLayer(v as BaseLayerId)}
              data={BASE_LAYERS.map((b) => ({ value: b.id, label: b.label }))}
              orientation="vertical"
              fullWidth
            />

            <Divider label="Filter" labelPosition="left" />
            <Select
              label="Mode"
              placeholder="All modes"
              data={modeOptions}
              value={modeFilter}
              onChange={(v) => {
                setModeFilter(v);
                if (v && signalFilter) {
                  const s = allSignals.find((x) => x.rowId === signalFilter);
                  if (s?.modeId !== v) setSignalFilter(null);
                }
              }}
              clearable
              searchable
            />
            <Select
              label="Signal"
              placeholder={signalOptions.length ? "All signals" : "No signals yet"}
              data={signalOptions}
              value={signalFilter}
              onChange={setSignalFilter}
              clearable
              searchable
              disabled={signalOptions.length === 0}
            />
            <DateTimePicker
              label="From"
              placeholder="Any"
              value={dateFrom}
              onChange={(v) => setDateFrom(v ? new Date(v) : null)}
              clearable
            />
            <DateTimePicker
              label="To"
              placeholder="Now"
              value={dateTo}
              onChange={(v) => setDateTo(v ? new Date(v) : null)}
              clearable
            />

            <Divider label="Layers" labelPosition="left" />
            <Switch
              label="Receptions (heatmap)"
              description="Where signals have been heard from"
              checked={showReceptions}
              onChange={(e) => setShowReceptions(e.currentTarget.checked)}
            />
            <Switch
              label="BNetzA antennas"
              description="Background overlay, zoom to load"
              checked={showLegacyAntennae}
              onChange={(e) => setShowLegacyAntennae(e.currentTarget.checked)}
            />
            {showLegacyAntennae && (
              <Stack gap="xs" pl="xs">
                <Group gap={10}>
                  <PinLegendDot fill="#16a34a" label="active" />
                  <PinLegendDot fill="#f59e0b" label="expired" />
                  <PinLegendDot fill="#9ca3af" label="inactive" />
                </Group>
                <Checkbox.Group
                  label="State"
                  value={legacyStates}
                  onChange={setLegacyStates}
                >
                  <Group gap="md" mt={4}>
                    <Checkbox value="Aktiv" label="Active" />
                    <Checkbox value="Inaktiv" label="Inactive" />
                  </Group>
                </Checkbox.Group>
                <MultiSelect
                  label="Service segment"
                  placeholder={serviceSegmentOptions.length ? "Any" : "Loading…"}
                  data={serviceSegmentOptions}
                  value={legacyServiceSegments}
                  onChange={setLegacyServiceSegments}
                  searchable
                  clearable
                  hidePickedOptions
                  maxValues={10}
                />
                <Group grow gap="xs" align="end">
                  <NumberInput
                    label="Frequency from"
                    placeholder="MHz"
                    value={legacyFreqMinMhz}
                    onChange={(v) => setLegacyFreqMinMhz(v === "" || v == null ? "" : String(v))}
                    decimalScale={6}
                    step={0.001}
                    allowNegative={false}
                    decimalSeparator="."
                    hideControls
                  />
                  <NumberInput
                    label="…to"
                    placeholder="MHz"
                    value={legacyFreqMaxMhz}
                    onChange={(v) => setLegacyFreqMaxMhz(v === "" || v == null ? "" : String(v))}
                    decimalScale={6}
                    step={0.001}
                    allowNegative={false}
                    decimalSeparator="."
                    hideControls
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  Type the same value in both fields for an exact-frequency match. Either side of a duplex pair counts.
                </Text>
              </Stack>
            )}

            <Divider />
            <Button onClick={() => { form.setValues({ ...emptyBearing, signalId: signalFilter }); openBearingModal(); }}>
              Add bearing
            </Button>

            {fetching && !d && <Loader size="sm" />}
            {error && <Alert color="red" title="Failed to load">{error.message}</Alert>}

            {d && (
              <Card withBorder padding="xs" radius="sm">
                <Stack gap={2}>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Receivers</Text>
                    <Badge variant="light" color="blue">{d.receivers?.nodes?.length ?? 0}</Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Transmitters</Text>
                    <Badge variant="light" color="red">{d.transmitters?.nodes?.length ?? 0}</Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Bearings (visible)</Text>
                    <Badge variant="light" color="orange">{visibleBearings.length}</Badge>
                  </Group>
                  {showReceptions && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Receptions {receptionsFetching && "…"}</Text>
                      <Badge variant="light" color="grape">{receptions.length}</Badge>
                    </Group>
                  )}
                  {showLegacyAntennae && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Legacy antennas {legacyFetching && "…"}</Text>
                      <Badge variant="filled" color="yellow" c="dark">{legacyAntennae.length}</Badge>
                    </Group>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>
        </ScrollArea>
      </Paper>

      <Box style={{ position: "relative" }}>
        <MapCanvas
          baseLayer={baseLayer}
          receivers={receivers}
          transmitters={transmitters}
          bearings={visibleBearings}
          receptions={receptions}
          legacyAntennae={legacyAntennae}
          // With a tight filter you get a handful of pins — render them at
          // every zoom so they're not hidden when the user zooms out. With a
          // big result set, keep the z9 floor so country zoom isn't a sea of
          // pins.
          legacyAntennaeMinZoom={legacyAntennae.length <= 10000 ? 0 : 9}
          showReceptions={showReceptions}
          showLegacyAntennae={showLegacyAntennae}
          onBearingClick={(signalId) => {
            void navigate({ to: "/signals", search: { signalId } as any });
          }}
          onLegacyAntennaClick={(antennaId) => setSelectedAntennaId(antennaId)}
          onMoveEnd={(bounds) => {
            // Always track the current viewport so that toggling the BNetzA
            // overlay on can run its bbox query immediately, without waiting
            // for a pan. The query itself is gated by `showLegacyAntennae`.
            const b = bounds as [[number, number], [number, number]];
            const [[swLon, swLat], [neLon, neLat]] = b;
            setLegacyBbox({ minLat: swLat, maxLat: neLat, minLon: swLon, maxLon: neLon });
          }}
        />
        <Tooltip label="Reset base map to default">
          <ActionIcon
            variant="default"
            size="lg"
            radius="md"
            onClick={() => setBaseLayer(DEFAULT_BASE_LAYER)}
            style={{ position: "absolute", left: 12, top: 12, zIndex: 5 }}
            aria-label="Reset base layer"
          >
            <Text size="sm" fw={600} lh={1}>↺</Text>
          </ActionIcon>
        </Tooltip>
      </Box>

      <Modal opened={bearingModalOpened} onClose={onCloseBearing} title="New bearing" size="md">
        <form onSubmit={handleSubmitBearing}>
          <Stack>
            <Select
              label="Signal"
              placeholder={signalOptions.length ? "Which signal did you hear?" : "Add a signal first"}
              data={signalOptions}
              required
              searchable
              disabled={signalOptions.length === 0}
              {...form.getInputProps("signalId")}
            />
            <Select
              label="Receiver"
              placeholder={receiverOptions.length ? "Which receiver heard it?" : "Add a receiver with coordinates first"}
              data={receiverOptions}
              required
              searchable
              disabled={receiverOptions.length === 0}
              {...form.getInputProps("receiverId")}
            />
            <DateTimePicker
              label="Observed at"
              required
              {...form.getInputProps("observedAt")}
            />
            <Group grow>
              <NumberInput
                label="Azimuth (°)"
                description="0 = North, 90 = East"
                min={0}
                max={359.9}
                step={1}
                decimalScale={2}
                required
                {...form.getInputProps("azimuthDeg")}
              />
              <NumberInput
                label="Uncertainty (± °)"
                description="Half-width of the wedge"
                min={0}
                max={180}
                step={1}
                decimalScale={2}
                {...form.getInputProps("uncertaintyDeg")}
              />
            </Group>
            <Textarea
              label="Notes"
              autosize
              minRows={2}
              maxRows={6}
              placeholder="DF gear, conditions, confidence…"
              {...form.getInputProps("notes")}
            />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={onCloseBearing} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={signalOptions.length === 0 || receiverOptions.length === 0}>
                Record bearing
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <LegacyAntennaModal
        opened={!!selectedAntennaId}
        onClose={() => setSelectedAntennaId(null)}
        fetching={antennaDetailFetching}
        error={antennaDetailError?.message}
        antenne={ad?.antenne}
      />
    </Box>
  );
}

function LegacyAntennaModal(props: {
  opened: boolean;
  onClose: () => void;
  fetching: boolean;
  error?: string;
  antenne: any | null | undefined;
}) {
  const { opened, onClose, fetching, error, antenne: a } = props;
  const z = a?.zuteilung;
  const f = a?.funkanlage;
  const siteAssignments = (f?.zuordnungfrequenzfunkanlages?.nodes ?? []) as any[];
  const siteAssignmentTotal: number = f?.zuordnungfrequenzfunkanlages?.totalCount ?? 0;
  const allocFrequencies = (z?.frequenzs?.nodes ?? []) as any[];
  const allocFrequencyTotal: number = z?.frequenzs?.totalCount ?? 0;
  const siteFrequencyIds = new Set(siteAssignments.map((za) => za?.frequenz?.rowId).filter(Boolean));

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={
      <Group gap="sm">
        <Badge color="gray" variant="light">BNetzA antenna</Badge>
        {z?.fachschluessel && (
          <Text ff="monospace" size="sm">Allocation {z.fachschluessel}</Text>
        )}
      </Group>
    }>
      {fetching && !a && <Loader size="sm" />}
      {error && <Alert color="red" title="Failed to load">{error}</Alert>}
      {a && (
        <Stack gap="md">
          <DetailSection title={a.name ?? "Antenna"}>
            <DetailGrid items={[
              ["Type", a.artname],
              ["Height (above ground)", a.hoeheuebergrund != null ? `${a.hoeheuebergrund} m` : null],
              ["Height (above sea level)", a.hoeheuebermeeresspiegel != null ? `${a.hoeheuebermeeresspiegel} m` : null],
              ["Azimuth", a.azimut != null ? `${a.azimut}°` : null],
              ["Polarization", a.polarisationname],
              ["Antenna gain", formatUnitPair(a.gewinn, a.gewinneinheitname)],
              ["Transmitter power", formatUnitPair(a.senderausgangsleistung, a.senderausgangsleistungeinheitname)],
              ["Radiated power (ERP)", formatUnitPair(a.strahlungsleistung, a.strahlungsleistungeinheitname)],
              ["Location", a.lat != null && a.lon != null ? `${Number(a.lat).toFixed(5)}, ${Number(a.lon).toFixed(5)}` : null],
              ["Site description", a.ortsbeschreibung],
            ]} />
          </DetailSection>

          {f && (
            <DetailSection title="Radio station">
              <DetailGrid items={[
                ["Name", f.name],
                ["Category", f.kategoriename],
                ["Type", f.artname],
                ["Address", formatAddresses(f.adresses?.nodes)],
              ]} />
            </DetailSection>
          )}

          {z && (
            <DetailSection title="Allocation">
              <DetailGrid items={[
                ["Allocation number", z.fachschluessel],
                ["Holder", z.zuteilungsinhabername],
                ["Status", renderAllocationStatus(z)],
                ["Purpose", z.verwendungszweck],
                ["Service segment", z.dienstsegmentname],
                ["Coverage area", z.funkversorgungsgebiet],
                ["Network call sign", z.rufnamefunknetz],
                ["Issued", formatDate(z.ausstellung)],
                ["Effective from", formatDate(z.wirksam)],
                ["Expires", formatDate(z.befristung)],
                ["Terminated", formatTerminated(z.beendigung, z.beendigungsgrundname)],
              ]} />
            </DetailSection>
          )}

          {siteAssignments.length > 0 && (
            <DetailSection
              title={
                siteAssignmentTotal === 1
                  ? "Frequency used at this site"
                  : `Frequencies used at this site (${siteAssignmentTotal}${siteAssignments.length < siteAssignmentTotal ? `, showing ${siteAssignments.length}` : ""})`
              }
            >
              <Table.ScrollContainer minWidth={600}>
                <Table withTableBorder withColumnBorders fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>On air</Table.Th>
                      <Table.Th>Paired</Table.Th>
                      <Table.Th>Channel</Table.Th>
                      <Table.Th>Bandwidth</Table.Th>
                      <Table.Th>Modulation</Table.Th>
                      <Table.Th>Mode</Table.Th>
                      <Table.Th>Emission</Table.Th>
                      <Table.Th>System codes</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {siteAssignments.map((za) => {
                      const fr = za.frequenz ?? {};
                      const { primary, paired, role, pairedRole } = splitDuplexPair(
                        fr,
                        za.frequenzpaarauswahlname
                      );
                      return (
                        <Table.Tr key={za.rowId}>
                          <Table.Td ff="monospace" fw={500}>
                            {primary ?? "—"}
                            {role && (
                              <Text component="span" size="xs" c="dimmed" ml={6}>
                                {role}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td ff="monospace" c="dimmed">
                            {paired ?? "—"}
                            {pairedRole && (
                              <Text component="span" size="xs" c="dimmed" ml={6}>
                                {pairedRole}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>{fr.kanal ?? "—"}</Table.Td>
                          <Table.Td>{formatUnitPair(fr.kanalbandbreite, fr.kanalbandbreiteeinheitname) ?? "—"}</Table.Td>
                          <Table.Td>{fr.modulationsverfahrenname ?? "—"}</Table.Td>
                          <Table.Td>{fr.betriebsarten ?? "—"}</Table.Td>
                          <Table.Td>{fr.sendearten ?? "—"}</Table.Td>
                          <Table.Td><SystemCodeChips raw={fr.systemcodes} /></Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </DetailSection>
          )}

          {allocFrequencies.length > 0 && (
            <DetailSection
              title={`All frequencies in this allocation (${allocFrequencyTotal}${allocFrequencies.length < allocFrequencyTotal ? `, showing ${allocFrequencies.length}` : ""})`}
            >
              <Text size="xs" c="dimmed">
                Every frequency the holder may use under allocation {z.fachschluessel}. Rows used at this site are highlighted.
              </Text>
              <Table.ScrollContainer minWidth={600}>
                <Table withTableBorder withColumnBorders fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Lower (f₁)</Table.Th>
                      <Table.Th>Upper (f₂)</Table.Th>
                      <Table.Th>Channel</Table.Th>
                      <Table.Th>Bandwidth</Table.Th>
                      <Table.Th>Modulation</Table.Th>
                      <Table.Th>Mode</Table.Th>
                      <Table.Th>Emission</Table.Th>
                      <Table.Th>System codes</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {allocFrequencies.map((fr) => {
                      const inUse = siteFrequencyIds.has(fr.rowId);
                      return (
                        <Table.Tr key={fr.rowId} bg={inUse ? "var(--mantine-color-yellow-light)" : undefined}>
                          <Table.Td ff="monospace">{formatUnitPair(fr.frequenz1, fr.frequenz1Einheitname) ?? "—"}</Table.Td>
                          <Table.Td ff="monospace">{formatUnitPair(fr.frequenz2, fr.frequenz2Einheitname) ?? "—"}</Table.Td>
                          <Table.Td>{fr.kanal ?? "—"}</Table.Td>
                          <Table.Td>{formatUnitPair(fr.kanalbandbreite, fr.kanalbandbreiteeinheitname) ?? "—"}</Table.Td>
                          <Table.Td>{fr.modulationsverfahrenname ?? "—"}</Table.Td>
                          <Table.Td>{fr.betriebsarten ?? "—"}</Table.Td>
                          <Table.Td>{fr.sendearten ?? "—"}</Table.Td>
                          <Table.Td><SystemCodeChips raw={fr.systemcodes} /></Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </DetailSection>
          )}
        </Stack>
      )}
    </Modal>
  );
}

function PinLegendDot({ fill, label }: { fill: string; label: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Box
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: fill,
          border: "1.5px solid #1f2937",
          flex: "0 0 auto",
        }}
      />
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
}

function SystemCodeChips({ raw }: { raw: unknown }) {
  if (typeof raw !== "string" || raw.trim() === "") return <Text size="xs" c="dimmed">—</Text>;
  const codes = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {codes.map((code) => (
        <Badge key={code} size="xs" variant="light" color="indigo" ff="monospace">
          {code}
        </Badge>
      ))}
    </Group>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap={6}>
      <Text fw={600} size="sm">{title}</Text>
      {children}
    </Stack>
  );
}

function DetailGrid({ items }: { items: [string, React.ReactNode][] }) {
  const present = items.filter(([, v]) => v != null && v !== "");
  if (present.length === 0) return <Text size="xs" c="dimmed">No data.</Text>;
  return (
    <Box style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 16, rowGap: 4 }}>
      {present.map(([k, v]) => (
        <ContextRow key={k} label={k} value={v} />
      ))}
    </Box>
  );
}

function ContextRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{label}</Text>
      <Text size="sm">{value}</Text>
    </>
  );
}

// Map an allocation row to a pin image id.
//   Green  = statecodename Aktiv AND befristung in the future (or null)
//   Orange = statecodename Aktiv AND befristung in the past (expired by date)
//   Gray   = statecodename Inaktiv, or no allocation, or unknown state
function pinIdForAllocation(
  zuteilung: { statecodename?: string | null; befristung?: string | null } | null | undefined,
  nowMs: number
): string {
  if (!zuteilung || zuteilung.statecodename !== "Aktiv") {
    return LEGACY_PIN_IMAGE_IDS.gray;
  }
  if (zuteilung.befristung) {
    const expiryMs = Date.parse(zuteilung.befristung);
    if (Number.isFinite(expiryMs) && expiryMs < nowMs) {
      return LEGACY_PIN_IMAGE_IDS.orange;
    }
  }
  return LEGACY_PIN_IMAGE_IDS.green;
}

// Render the allocation's overall status as a coloured pill + secondary text.
// Mirrors the pin colour rules in pinIdForAllocation so the modal and the
// map agree visually.
function renderAllocationStatus(
  z: { statecodename?: string | null; statuscodename?: string | null; befristung?: string | null } | null | undefined
): React.ReactNode {
  if (!z?.statecodename) return null;
  const expired =
    z.statecodename === "Aktiv" &&
    !!z.befristung &&
    Date.parse(z.befristung) < Date.now();
  const color = z.statecodename === "Inaktiv" ? "gray" : expired ? "orange" : "green";
  const primary = z.statecodename + (expired ? " (expired by date)" : "");
  return (
    <Group gap={6} wrap="wrap">
      <Badge color={color} variant="filled" size="sm">{primary}</Badge>
      {z.statuscodename && z.statuscodename !== z.statecodename && (
        <Text size="xs" c="dimmed">{z.statuscodename}</Text>
      )}
    </Group>
  );
}

function formatUnitPair(value: unknown, unit: unknown): string | null {
  if (value == null || value === "") return null;
  return unit ? `${value} ${unit}` : String(value);
}

// BNetzA encodes which side of a duplex pair a station is on as
// `frequenzpaarauswahlname` on the radio-station/frequency junction.
// - "Unterband" → station uses frequenz1 (lower); paired frequency is frequenz2
// - "Oberband"  → station uses frequenz2 (upper); paired frequency is frequenz1
// Anything else (null, "Beide", simplex with only frequenz1) falls back to
// frequenz1 as primary and frequenz2 (if present) as paired.
function splitDuplexPair(
  fr: { frequenz1?: unknown; frequenz1Einheitname?: unknown; frequenz2?: unknown; frequenz2Einheitname?: unknown },
  pairAuswahl: string | null | undefined
): { primary: string | null; paired: string | null; role: string | null; pairedRole: string | null } {
  const f1 = formatUnitPair(fr.frequenz1, fr.frequenz1Einheitname);
  const f2 = formatUnitPair(fr.frequenz2, fr.frequenz2Einheitname);
  if (pairAuswahl === "Oberband") {
    return { primary: f2 ?? f1, paired: f1, role: "Oberband", pairedRole: f1 ? "Unterband" : null };
  }
  if (pairAuswahl === "Unterband") {
    return { primary: f1, paired: f2, role: "Unterband", pairedRole: f2 ? "Oberband" : null };
  }
  return { primary: f1, paired: f2, role: pairAuswahl ?? null, pairedRole: null };
}

function formatAddresses(nodes: unknown): React.ReactNode | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const lines = nodes
    .map((a: any) => {
      const cityLine = [a?.postleitzahl, a?.ort].filter(Boolean).join(" ").trim();
      const parts = [a?.strasse, cityLine].filter((s) => typeof s === "string" && s.trim() !== "");
      const main = parts.join(", ");
      const extra = a?.ortsbeschreibung && typeof a.ortsbeschreibung === "string" ? a.ortsbeschreibung.trim() : "";
      if (!main && !extra) return null;
      return extra ? `${main}${main ? " — " : ""}${extra}` : main;
    })
    .filter((s): s is string => !!s);
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0];
  return (
    <Stack gap={2}>
      {lines.map((l, i) => <Text key={i} size="sm">{l}</Text>)}
    </Stack>
  );
}

function formatTerminated(iso: unknown, reason: unknown): string | null {
  const date = formatDate(iso);
  const r = typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null;
  if (date && r) return `${date} (${r})`;
  if (date) return date;
  if (r) return r;
  return null;
}

function formatDate(iso: unknown): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}
