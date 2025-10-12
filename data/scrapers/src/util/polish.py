import regex as re
from enum import Enum
import io
import csv

# TODO Is there any better way to list upper case characters?
UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"

LOWER = UPPER.lower()

MONTH_NUMBER = {
    "styczeń": 1,
    "luty": 2,
    "marzec": 3,
    "kwiecień": 4,
    "maj": 5,
    "czerwiec": 6,
    "lipiec": 7,
    "sierpień": 8,
    "wrzesień": 9,
    "październik": 10,
    "listopad": 11,
    "grudzień": 12,
}

MONTH_NUMBER_GENITIVE = {
    "stycznia": 1,
    "lutego": 2,
    "marca": 3,
    "kwietnia": 4,
    "maja": 5,
    "czerwca": 6,
    "lipca": 7,
    "sierpnia": 8,
    "września": 9,
    "października": 10,
    "listopada": 11,
    "grudnia": 12,
}


def csv_to_freq_map(url: str, file_path: str):
    def generator():
        f = open(file_path, "r", encoding="utf-8")
        for line in f.readlines():
            yield line

    first = True
    for line in csv.reader(generator()):
        if first:
            first = False
            continue
        woj = line[0]
        name = line[1]
        count = int(line[2])


class OverlapCalculator:
    def __init__(self) -> None:
        self.male_surnames_by_woj = "https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65049/table"
        self.female_surnames_by_woj = "https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65090/table"

    def chance(
        self,
        birthdate: str,
        first_name: str | None = None,
        second_name: str | None = None,
        last_name: str | None = None,
        teryt_code: str | None = None,
    ):
        n = self._sample(birthdate, teryt_code)
        overlap_chance = 1
        if first_name is not None:
            overlap_chance *= self._first_name_freq(first_name)
        if second_name is not None:
            overlap_chance *= self._second_name_freq(second_name)
        if last_name is not None:
            overlap_chance *= self._last_name_freq(last_name)

        return pow(1 - overlap_chance, n)

    def _sample(self, birthdate: str, teryt_code: str | None = None):
        if teryt_code is None:
            raise NotImplementedError(
                "Version without teryt is not supported right now"
            )

    def _first_name_freq(self, first_name: str):
        raise NotImplementedError()

    def _second_name_freq(self, second_name: str):
        raise NotImplementedError()

    def _last_name_freq(self, last_name: str):
        raise NotImplementedError()


class PkwFormat(Enum):
    First_Last = 1
    Last_First = 2
    First_LAST = 3
    LAST_First = 4


def parse_name(pkw_name: str, format: PkwFormat):
    words = pkw_name.split(" ")
    first_name, middle_name, last_name = "", "", ""
    match format:
        case PkwFormat.First_Last:
            last_name = words[-1]
            first_name = words[0]
            if len(words) > 2:
                middle_name = " ".join(words[1:-1])
        case PkwFormat.First_LAST:
            m = re.search(f"((?: [-{UPPER}]+)+)$", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[: -len(m.group(0))].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case PkwFormat.LAST_First:
            m = re.match(f"((?:[-{UPPER}]+ )+)", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[len(m.group(0)) :].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case _:
            raise ValueError(f"Unsupported format: {pkw_name}")

    return first_name, middle_name, last_name
