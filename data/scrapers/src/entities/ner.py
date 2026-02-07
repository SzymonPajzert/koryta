from dataclasses import dataclass, field
from typing import List


@dataclass
class NEREntities:
    personalia: List[dict] = field(default_factory=list)
    locations: List[dict] = field(default_factory=list)
    organizations: List[dict] = field(default_factory=list)
