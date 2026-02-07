import unittest
from dataclasses import dataclass

from stores.duckdb import EntityDumper


@dataclass
class TypeA:
    val: int


@dataclass
class TypeB:
    name: str


class TestEntityDumper(unittest.TestCase):
    def setUp(self):
        # Reset shared state
        EntityDumper.inmemory = {}
        EntityDumper.sort_keys = {}
        self.dumper = EntityDumper()

    def tearDown(self):
        # Clean up
        EntityDumper.inmemory = {}
        EntityDumper.sort_keys = {}

    def test_get_output_multiple_types(self):
        # 1. Write Type A
        a1 = TypeA(val=1)
        a2 = TypeA(val=2)
        self.dumper.insert_into(a1, sort_by=[])
        self.dumper.insert_into(a2, sort_by=[])

        # 2. Write Type B
        b1 = TypeB(name="foo")
        self.dumper.insert_into(b1, sort_by=[])

        def get_name(t):
            mod = t.__module__.removeprefix("entities.")
            n = mod + "." + t.__name__
            return n.replace(".", "_")

        name_a = get_name(TypeA)
        name_b = get_name(TypeB)

        output_a = self.dumper.get_output(name_a)
        output_b = self.dumper.get_output(name_b)

        # 4. Assertions
        self.assertIsNotNone(output_a)
        self.assertEqual(len(output_a), 2)
        self.assertEqual(output_a[0], a1)
        self.assertEqual(output_a[1], a2)

        self.assertIsNotNone(output_b)
        self.assertEqual(len(output_b), 1)
        self.assertEqual(output_b[0], b1)

        # Verify no cross-contamination
        self.assertNotIn(b1, output_a)
        self.assertNotIn(a1, output_b)
