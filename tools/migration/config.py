"""Configuration & transformation rules for the LMR migration.

This is the single source of truth for *all* schema decisions:
- which columns are dropped
- which columns are renamed
- which columns are combined (geo)
- which columns are FKs and to what
- type overrides where the analyzer couldn't decide

Reusable: re-run the pipeline at any time; behavior is determined by this file.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Connection / schema target
# ---------------------------------------------------------------------------
PG_SCHEMA = "legacy"  # all imported tables land here; reserves `public` for future read/write side
SOURCE_FILES = ["a.xlsx", "b.xlsx"]

# Sheets in the workbooks that are empty placeholders from Excel.
SKIP_SHEETS = {"Tabelle1", "Tabelle9"}

# Prefix to strip from every column name and every table identifier inside the PG schema.
STRIP_PREFIX = "bnetza_"

# ---------------------------------------------------------------------------
# Table → primary key column (in the *source* xlsx). Renamed to `id` in PG.
# Junction tables have weird names (Dynamics truncated them).
# ---------------------------------------------------------------------------
PK_BY_TABLE: dict[str, str] = {
    "sendeart": "bnetza_zfd_sendeartid",
    "uebertragungsart": "bnetza_zfd_uebertragungsartid",
    "systemcode": "bnetza_zfd_systemcodeid",
    "antenne": "bnetza_zfd_antenneid",
    "frequenz": "bnetza_zfd_frequenzid",
    "funkanlagenart": "bnetza_zfd_funkanlagenartid",
    "funkanlage": "bnetza_zfd_funkanlageid",
    "zuordnungfrequenzfunkanlage": "bnetza_zfd_zuordnungfrequenzfunkanlageid",
    "zuteilung": "bnetza_zfd_zuteilungid",
    "betriebsart": "bnetza_zfd_betriebsartid",
    "frequenzbetriebsart": "bnetza_bnetza_zfd_frequenz_bnetza_zfd_betriebsid",
    "frequenzsendeart": "bnetza_bnetza_zfd_frequenz_bnetza_zfd_sendeartid",
    "strahlungsleistung": "bnetza_zfd_strahlungsleistungid",
    # strahlungsleistungvorlage has no matching *id column at all in our export — synthesize uuid
    "strahlungsleistungvorlage": None,
    "senderausgangsleistung": "bnetza_zfd_senderausgangsleistungid",
    "frequenzvorlage": "bnetza_zfd_frequenzvorlageid",
    "frequenzsystemcode": "bnetza_bnetza_zfd_frequenz_bnetza_zfd_systemcoid",
    "frequenzuebertragungsart": "bnetza_bnetza_zfd_frequenz_bnetza_zfd_uebertraid",
    "frequenzzeitschlitz": "bnetza_bnetza_zfd_frequenz_bnetza_zfd_zeitschlid",
    "zeitschlitz": "bnetza_zfd_zeitschlitzid",
    "antennenvorlage": "bnetza_zfd_antennenvorlageid",
    "untergruppe": "bnetza_zfd_untergruppeid",
    "textbaustein": "bnetza_zfd_textbausteinid",
    "textbausteingruppe": "bnetza_zfd_textbausteingruppeid",
    "adresse": "bnetza_zfd_adresseid",
    "bestandsaenderung": "bnetza_zfd_bestandsaenderungid",
    "koordinierung": "bnetza_zfd_koordinierungid",
    "organisationseinheit": "bnetza_zfd_organisationseinheitid",
    "pruefdaten": "bnetza_zfd_pruefdatenid",
    "bestandsuebertragung": "bnetza_zfd_bestandsuebertragungid",
    "dokument": "bnetza_zfd_dokumentid",
}

# ---------------------------------------------------------------------------
# Foreign keys. (col_in_source, target_table) — keys reference target's PK.
# Audit FKs (createdby, modifiedby, ownerid, owningbusinessunit, owningteam,
# modifiedonbehalfby, createdonbehalfby) point to user/team tables not in the
# export → kept as plain uuid (no constraint), labels preserved.
# ---------------------------------------------------------------------------
FK_MAP: dict[str, list[tuple[str, str]]] = {
    "antenne": [
        ("bnetza_funkanlage", "funkanlage"),
        ("bnetza_zuteilung", "zuteilung"),
        ("bnetza_vorlage", "antennenvorlage"),
    ],
    "frequenz": [
        ("bnetza_zuteilung", "zuteilung"),
        ("bnetza_vorlage", "frequenzvorlage"),
    ],
    "funkanlage": [
        ("bnetza_zuteilung", "zuteilung"),
        ("bnetza_art", "funkanlagenart"),
    ],
    "zuordnungfrequenzfunkanlage": [
        ("bnetza_frequenz", "frequenz"),
        ("bnetza_funkanlage", "funkanlage"),
    ],
    "zuteilung": [
        ("bnetza_untergruppe", "untergruppe"),
    ],
    "frequenzbetriebsart": [
        ("bnetza_zfd_frequenzid", "frequenz"),
        ("bnetza_zfd_betriebsartid", "betriebsart"),
    ],
    "frequenzsendeart": [
        ("bnetza_zfd_frequenzid", "frequenz"),
        ("bnetza_zfd_sendeartid", "sendeart"),
    ],
    "strahlungsleistung": [
        ("bnetza_frequenz", "frequenz"),
        ("bnetza_vorlage", "strahlungsleistungvorlage"),
    ],
    "strahlungsleistungvorlage": [
        ("bnetza_frequenzvorlage", "frequenzvorlage"),
    ],
    "senderausgangsleistung": [
        ("bnetza_frequenz", "frequenz"),
    ],
    "frequenzvorlage": [
        ("bnetza_untergruppe", "untergruppe"),
    ],
    "frequenzsystemcode": [
        ("bnetza_zfd_frequenzid", "frequenz"),
        ("bnetza_zfd_systemcodeid", "systemcode"),
    ],
    "frequenzuebertragungsart": [
        ("bnetza_zfd_frequenzid", "frequenz"),
        ("bnetza_zfd_uebertragungsartid", "uebertragungsart"),
    ],
    "frequenzzeitschlitz": [
        ("bnetza_zfd_frequenzid", "frequenz"),
        ("bnetza_zfd_zeitschlitzid", "zeitschlitz"),
    ],
    "textbaustein": [
        ("bnetza_textbausteingruppe", "textbausteingruppe"),
    ],
    "adresse": [
        ("bnetza_funkanlage", "funkanlage"),
    ],
    "bestandsaenderung": [
        ("bnetza_funkanlage", "funkanlage"),
    ],
    "koordinierung": [
        ("bnetza_antenne", "antenne"),
        ("bnetza_frequenz", "frequenz"),
        ("bnetza_funkanlage", "funkanlage"),
        ("bnetza_zuteilung", "zuteilung"),
    ],
    "pruefdaten": [
        ("bnetza_zuteilung", "zuteilung"),
    ],
    "bestandsuebertragung": [
        ("bnetza_zuteilung", "zuteilung"),
    ],
    "dokument": [
        ("bnetza_zuteilung", "zuteilung"),
    ],
}

# ---------------------------------------------------------------------------
# Columns to drop globally, regardless of table.
# These are always-empty in our sample OR known noise (yominame, local-time
# duplicates of UTC, behalf-by, etc).
# ---------------------------------------------------------------------------
GLOBAL_DROP: set[str] = {
    # Dynamics audit fields that are always empty in this tenant
    "createdonbehalfby",
    "createdonbehalfbyname",
    "createdonbehalfbyyominame",
    "modifiedonbehalfby",
    "modifiedonbehalfbyname",
    "modifiedonbehalfbyyominame",
    "overriddencreatedon",
    "overriddencreatedonutc",
    "importsequencenumber",
    "timezoneruleversionnumber",
    "utcconversiontimezonecode",
    "owneridyominame",
    "owninguser",
    # Japanese phonetic name duplicates
    "createdbyyominame",
    "modifiedbyyominame",
    # local-time duplicates — we keep the UTC variant and rename it back to the base name
    "createdon",
    "modifiedon",
}

# Detect *utc twins automatically: for any column ending in `utc` whose base
# (without `utc`) also exists, we drop the base and rename utc → base.
AUTO_DROP_UTC_TWIN_BASE = True

# Detect <col> + <col>name pairs where <col> is boolean and <col>name only
# contains "Ja"/"Nein": drop the name companion.
AUTO_DROP_JA_NEIN_TWIN = True

# ---------------------------------------------------------------------------
# Per-column type overrides. Format: "<table>.<source_col>" → pg_type
# Used for ambiguous int/float ("MIXED") cols that should be `numeric`.
# ---------------------------------------------------------------------------
TYPE_OVERRIDES: dict[str, str] = {
    "antenne.bnetza_senderausgangsleistung": "numeric",
    "antenne.bnetza_strahlungsleistung": "numeric",
    "antenne.bnetza_zufuehrungsverlust": "numeric",
    "frequenz.bnetza_frequenz1": "numeric",
    "frequenz.bnetza_frequenz2": "numeric",
    "frequenz.bnetza_kanalabstand": "numeric",
    "frequenz.bnetza_kanalbandbreite": "numeric",
    "frequenz.bnetza_mobiletoleranz": "numeric",
    "frequenz.bnetza_ortsfestetoleranz": "numeric",
    "frequenz.bnetza_teilgebuehr": "numeric",
    "frequenz.bnetza_zeitschlitze": "text",  # mostly int, some textual
    "frequenz.bnetza_duplexabstand": "numeric",
    "strahlungsleistung.bnetza_leistung": "numeric",
    "strahlungsleistungvorlage.bnetza_leistung": "numeric",
    "senderausgangsleistung.bnetza_leistung": "numeric",
    "frequenzvorlage.bnetza_frequenz1": "numeric",
    "frequenzvorlage.bnetza_frequenz2": "numeric",
    "frequenzvorlage.bnetza_duplexabstand": "numeric",
    "frequenzvorlage.bnetza_kanalabstand": "numeric",
    "frequenzvorlage.bnetza_kanalbandbreite": "numeric",
    "frequenzvorlage.bnetza_mobiletoleranz": "numeric",
    "frequenzvorlage.bnetza_ortsfestetoleranz": "numeric",
    "antennenvorlage.bnetza_gewinn": "numeric",
    # antenne lat/lon raw values: keep as numeric to preserve precision
    "antenne.bnetza_nordgrad": "numeric",
    "antenne.bnetza_nordminuten": "numeric",
    "antenne.bnetza_nordsekunden": "numeric",
    "antenne.bnetza_ostgrad": "numeric",
    "antenne.bnetza_ostminuten": "numeric",
    "antenne.bnetza_ostsekunden": "numeric",
}

# Columns holding the 9-digit "Zuteilungsnummer" / "Fachschlüssel" /
# "Frequenzzuteilungs-ID" identifiers. Source values look like `100 001 123`
# (with two spaces) or `027 013 362-0001`. We strip the spaces so they're
# stored as compact strings like `100001123` / `027013362-0001`.
# Keys: "<source_sheet>.<source_column>".
STRIP_SPACES_IN_VALUES: set[str] = {
    "antenne.bnetza_zuteilungname",
    "frequenz.bnetza_zuteilungname",
    "frequenz.bnetza_frequenzzuteilungsid",
    "funkanlage.bnetza_zuteilungname",
    "zuteilung.bnetza_fachschluessel",
    "koordinierung.bnetza_zuteilungname",
    "pruefdaten.bnetza_zuteilungname",
    "bestandsuebertragung.bnetza_zuteilungname",
    "dokument.bnetza_zuteilungname",
}

# Unit-normalized columns: each entry synthesizes one new `<out>_hz` numeric
# column from a (value, unit-label) pair already present in the source row.
# Lets filters compare frequencies on a single canonical scale instead of
# mixing 450.6 MHz with 1.2 GHz as if they were the same number. Mirrors the
# GEO_COMBINE pattern: declared here, planned in transform.py, written in
# extract.py, indexed in build_schema.py.
HZ_NORMALIZE: dict[str, list[dict]] = {
    "frequenz": [
        {"value_col": "bnetza_frequenz1", "unit_col": "bnetza_frequenz1einheitname", "out_col": "frequenz1_hz"},
        {"value_col": "bnetza_frequenz2", "unit_col": "bnetza_frequenz2einheitname", "out_col": "frequenz2_hz"},
    ],
    "frequenzvorlage": [
        {"value_col": "bnetza_frequenz1", "unit_col": "bnetza_frequenz1einheitname", "out_col": "frequenz1_hz"},
        {"value_col": "bnetza_frequenz2", "unit_col": "bnetza_frequenz2einheitname", "out_col": "frequenz2_hz"},
    ],
}

# Map unit-label text → multiplier to Hz. Tolerant of casing/whitespace.
# Distinct unit labels seen on legacy.frequenz are 'MHz' and 'GHz' only.
UNIT_MULTIPLIERS: dict[str, int] = {
    "Hz":  1,
    "kHz": 1_000,
    "MHz": 1_000_000,
    "GHz": 1_000_000_000,
    "THz": 1_000_000_000_000,
}

# Extra btree indexes on legacy tables for PostGraphile filter exposure.
# `postgraphile-plugin-connection-filter` only surfaces a column in
# `<Type>Filter` when there's a backing index — without these the map's
# bbox / state / segment filters return "Field not defined" errors. Each
# index gets the suffix `_idx`; emitted from build_schema.py with
# CREATE INDEX IF NOT EXISTS so a clean re-import restores them.
LEGACY_FILTER_INDEXES: dict[str, list[str]] = {
    "antenne":   ["lat", "lon"],
    "zuteilung": ["dienstsegmentname", "statecodename", "befristung"],
    # frequenz1/2 are the un-normalized columns; the hz versions are auto-
    # indexed from HZ_NORMALIZE. Keeping the raw indexes is cheap and helps
    # any future un-normalized query path.
    "frequenz":  ["frequenz1", "frequenz2"],
}

# Geographic columns: synthesized from deg/min/sec triples.
# Produces three columns: `lat` numeric, `lon` numeric, `location` geography.
# The numeric columns are also exposed via GraphQL so frontends can map points
# without needing the PostGIS GraphQL plugin (which doesn't yet support v5).
GEO_COMBINE = {
    "antenne": {
        "lat_cols": ("bnetza_nordgrad", "bnetza_nordminuten", "bnetza_nordsekunden"),
        "lon_cols": ("bnetza_ostgrad", "bnetza_ostminuten", "bnetza_ostsekunden"),
        "lat_out_col": "lat",
        "lon_out_col": "lon",
        "out_col": "location",  # geography(Point, 4326)
    },
}

# ---------------------------------------------------------------------------
# Smart-comments for PostGraphile (control GraphQL field naming, hide cols, etc.)
# Keys reference *renamed* table/column names (post-strip prefix).
# ---------------------------------------------------------------------------
SMART_COMMENTS: dict[str, str] = {
    # Example: hide the denormalized -name companion columns from GraphQL by default?
    # We keep them visible for now (user opted to keep all FK labels).
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def pg_table_name(source: str) -> str:
    """Stay German, strip nothing for table names (they don't have the prefix)."""
    return source


_ZFD_ID_RE = __import__("re").compile(r"^(?:bnetza_)?zfd_(.+?)id$")


def pg_column_name(source: str, table: str) -> str | None:
    """Return the PG column name for a source column, or None if it should be dropped."""
    src = source

    if src in GLOBAL_DROP:
        return None

    # PK rename → id
    if src == PK_BY_TABLE.get(table):
        return "id"

    # strip prefix
    if src.startswith(STRIP_PREFIX):
        out = src[len(STRIP_PREFIX):]
    else:
        out = src

    # special: zfd_<table>id → id (extra defence for non-standard PKs)
    if out == f"zfd_{table}id":
        return "id"

    # junction-table FKs (bnetza_zfd_<x>id) → <x>
    m = _ZFD_ID_RE.match(out)
    if m:
        return m.group(1)

    return out
