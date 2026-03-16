import typing
from dataclasses import dataclass


@dataclass
class Company:
    krs: str | None = None
    role: str | None = None
    start: str | None = None
    end: str | None = None


@dataclass
class Election:
    election_type: typing.Any
    committee: str | None = None
    election_year: str | None = None
    teryt: str | None = None


@dataclass
class Person:
    name: str

    companies: list[Company]
    elections: list[Election]
    party: list[str] | None = None
    wikipedia_url: str | None = None
    rejestr_io_url: str | None = None
