import io
import sys
from util.indenter import Nester

def test_nester_simple_indent():
    """Should indent a single level."""
    saved_stdout = sys.stdout
    try:
        out = io.StringIO()
        sys.stdout = out
        with Nester(indent_string="  "):
            print("hello")
        output = out.getvalue()
        assert output == "  hello\n"
    finally:
        sys.stdout = saved_stdout

def test_nester_nested_indent():
    """Should indent multiple levels."""
    saved_stdout = sys.stdout
    try:
        out = io.StringIO()
        sys.stdout = out
        with Nester(indent_string="  "):
            print("hello")
            with Nester(indent_string="  "):
                print("world")
        output = out.getvalue()
        assert output == "  hello\n    world\n"
    finally:
        sys.stdout = saved_stdout

def test_nester_generator_indent():
    """Should indent when used as a generator."""
    saved_stdout = sys.stdout
    try:
        out = io.StringIO()
        sys.stdout = out
        nester = Nester(indent_string="  ")
        for _ in nester(range(2)):
            print("item")
        output = out.getvalue()
        assert output == "  item\n  item\n"
    finally:
        sys.stdout = saved_stdout

def test_nester_buffer():
    """Should buffer output and return it from dump."""
    nester = Nester(indent_string="  ", buffer=True)
    with nester:
        print("hello")
    output = nester.dump()
    assert output == "  hello\n"
