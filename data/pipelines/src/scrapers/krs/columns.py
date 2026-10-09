"""Reading a KRS pipeline's own output back in the shape it was written.

Every pipeline here writes jsonl and reads it back with `pandas.read_json`,
which re-infers types from the text. Two of those inferences bite the KRS
pipelines in particular:

* a zero-padded KRS is all digits, so ``"0000000110"`` comes back as the
  integer ``110`` - and joining a re-read frame against a freshly built one
  matches nothing, silently;
* a column literally named ``date`` is parsed into a Timestamp whatever
  ``dtype`` asks for, so string comparisons against it raise.

Neither shows up while a pipeline is being processed, only when its cached
output is read - which is what makes them worth naming rather than working
around at each call site.
"""

import pandas as pd

#: The width of a KRS number, which is zero-padded to it everywhere.
KRS_DIGITS = 10

#: ``YYYY-MM-DD``. Equal to KRS_DIGITS by coincidence, so spelled separately.
ISO_DATE_LENGTH = 10

#: What `astype(str)` makes of a missing value, depending on which of pandas'
#: null sentinels the re-read frame ended up holding.
_NULL_TEXT = frozenset({"nan", "NaN", "None", "NaT", "<NA>", ""})


def _text(values: pd.Series) -> pd.Series:
    """A column as plain strings, with every spelling of null as ``""``.

    Via the nullable string dtype, because the two obvious spellings both go
    wrong: `astype(str)` leaves NaN as NaN rather than making "nan" of it, so a
    later comparison against a string is silently False; and `fillna("")` on a
    numeric column raises rather than filling.
    """
    text = values.astype("string").fillna("").astype(str).str.strip()
    return text.where(~text.isin(_NULL_TEXT), "")


def padded_krs(values: pd.Series) -> pd.Series:
    """A KRS column as zero-padded strings, however it was read back."""
    if pd.api.types.is_float_dtype(values):
        # A KRS column holding a null reads back as float, and "110.0"
        # zero-pads to "00000110.0", which is not a KRS number.
        values = values.astype("Int64")
    text = _text(values)
    return text.where(text == "", text.str.zfill(KRS_DIGITS))


def iso_dates(values: pd.Series) -> pd.Series:
    """A date column as ``YYYY-MM-DD`` strings, however it was read back.

    A missing date comes back as ``""`` rather than ``"nan"``: callers compare
    these as strings and hand them to `date.fromisoformat`, and an empty string
    is at least falsy where ``"nan"`` parses as neither.
    """
    if pd.api.types.is_datetime64_any_dtype(values):
        return values.dt.strftime("%Y-%m-%d").fillna("")
    return _text(values).str.slice(0, ISO_DATE_LENGTH)


def normalise(df: pd.DataFrame, *date_columns: str) -> pd.DataFrame:
    """A copy of ``df`` with its KRS and the named date columns re-stringified."""
    result = df.copy()
    if "krs" in result.columns:
        result["krs"] = padded_krs(result["krs"])
    for column in date_columns:
        if column in result.columns:
            result[column] = iso_dates(result[column])
    return result


def is_public(flags: pd.Series) -> pd.Series:
    """A column of "is this company publicly owned" as actual booleans.

    `astype(bool)` is not that. A column that came back as text - a frame read
    without `CompaniesKRS`'s pinned dtypes, a hand-made CSV - has `astype(bool)`
    call the string "False" true, and every company in the register would then
    be public, so `--public-employer` would filter nothing while looking like it
    had. Missing reads as false: not knowing who owns a company is not knowing
    that the public does.
    """
    return flag(flags)


def flag(flags: pd.Series) -> pd.Series:
    """A yes/no column as actual booleans, read as `is_public` reads its own.

    Missing reads as false, as does any text but "true" and "1".
    """
    if pd.api.types.is_bool_dtype(flags) or pd.api.types.is_numeric_dtype(flags):
        return flags.fillna(False).astype(bool)
    # Anything else is read as text, which on this pandas is the dtype a column
    # of Python strings gets - `object` is not the only way text arrives.
    return flags.map(
        lambda value: value is True or str(value).strip().lower() in {"true", "1"}
    ).astype(bool)
