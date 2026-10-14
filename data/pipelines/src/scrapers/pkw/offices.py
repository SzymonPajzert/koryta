"""Which office a local candidacy was for, in the site's words.

A local election fills several seats at once - the gmina's council and its
wójt, burmistrz or prezydent, the powiat's council, the sejmik, and in
Warszawa the dzielnica's council - and somebody may stand for two of them in
one year. Marcin Witko stood for Tomaszów Mazowiecki's council and for its
prezydent in 2010, winning the first and losing the run-off for the second.
Without the office the two are the same row: one town, one year, one
committee. The site stored them as two „Samorząd” copies that read as a
duplicate, and where both were won they were folded into one and a candidacy
went missing.

PKW's files say which office in one of two ways. A mayoral file names it in a
column (`Urząd`): a letter in 2002, 2014 and 2018, a word in 2006 and 2010,
the whole title with the place in 2024 ("Wójt Gminy Czarna"). A council file
does not, but its TERYT is the unit the council belongs to, and every year's
code says at what depth: `XX0000` a województwo, `XXYY00` a powiat, anything
else a gmina - checked over every local file from 1998 to 2024. 2024's
separate sejmik and dzielnica lists also name their council in a column of
their own.

What a gmina's council is called depends on the gmina: a town's is a „Rada
miasta”, and the rest are „Rada gminy” - a miejsko-wiejska gmina's council
calls itself „Rada Miejska” more often than not, but it is the gmina's council,
not the town's. The six-digit code PKW writes leaves off TERC's seventh digit,
which is what says, so it is looked up (`Teryt.gmina_kinds`).

1994's codes are the old voivodeships' and name no unit of today's, so those
candidacies get no office - nor does anything the rules here do not recognise.
Where there is none, the payload says „Samorząd” as it always has.
"""

import math
import typing

#: The offices, as `ElectionPosition` in `frontend/shared/model.ts` names them.
SEJMIK = "Sejmik"
RADA_POWIATU = "Rada powiatu"
RADA_MIASTA = "Rada miasta"
RADA_GMINY = "Rada gminy"
RADA_DZIELNICY = "Rada dzielnicy"
WOJT = "Wójt"
BURMISTRZ = "Burmistrz"
PREZYDENT = "Prezydent"

LOCAL_OFFICES = frozenset(
    {
        SEJMIK,
        RADA_POWIATU,
        RADA_MIASTA,
        RADA_GMINY,
        RADA_DZIELNICY,
        WOJT,
        BURMISTRZ,
        PREZYDENT,
    }
)

#: The executive, by the first word of however a mayoral file writes it.
_EXECUTIVES = {
    "w": WOJT,
    "wójt": WOJT,
    "b": BURMISTRZ,
    "burmistrz": BURMISTRZ,
    "p": PREZYDENT,
    "prezydent": PREZYDENT,
}

#: The councils a file names outright: `headers.py` writes these for 2024's
#: sejmik and dzielnica lists.
_NAMED_COUNCILS = {"rada sejmiku": SEJMIK, "rada dzielnicy": RADA_DZIELNICY}

#: A gmina's council, by TERC's kind of gmina (`teryt.GMINA_KINDS`).
_GMINA_COUNCILS = {
    "1": RADA_MIASTA,
    "2": RADA_GMINY,
    "3": RADA_GMINY,
    "8": RADA_DZIELNICY,
}


def local_office(
    position: typing.Any,
    teryt_candidacy: typing.Any,
    gmina_kinds: typing.Mapping[str, str],
) -> str | None:
    """The office one local candidacy was for, or None where nothing says.

    `position` is the PKW row's own, which only a mayoral file and the two
    named council lists fill in; `teryt_candidacy` is where the candidacy was.
    """
    if isinstance(position, str) and position.strip():
        text = " ".join(position.lower().split())
        if text in _NAMED_COUNCILS:
            return _NAMED_COUNCILS[text]
        return _EXECUTIVES.get(text.split()[0])

    code = teryt_code(teryt_candidacy)
    if code is None or len(code) != 6 or not code.isdigit():
        return None
    if code.endswith("0000"):
        return SEJMIK
    if code.endswith("00"):
        return RADA_POWIATU
    return _GMINA_COUNCILS.get(gmina_kinds.get(code, ""))


def teryt_code(value: typing.Any) -> str | None:
    """A TERYT code as the six digits it is written with.

    2024's lists are CSVs read with pandas guessing the types, so a code
    arrives as an int wherever its chunk was all digits: 76,886 council rows.
    All of them are from województwa 10 and up, so none has lost a leading
    zero yet; the padding is for the day one does.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value).zfill(6)
    if isinstance(value, float):
        return None if math.isnan(value) else str(int(value)).zfill(6)
    if isinstance(value, str):
        return value.strip()
    return None
