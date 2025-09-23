import sys
import io

class Nester:
    def __init__(self, indent_string="    ", buffer=False):
        self.level = 0
        self.indent_string = indent_string
        if buffer:
            self.saved_stdout = sys.stdout
            self.original_stdout = io.StringIO()
        else:
            self.original_stdout = sys.stdout
        self.buffer = buffer

    def __enter__(self):
        # Each time we enter a 'with' block, increase the level
        self.level += 1
        # On the first level of entry, redirect stdout
        if self.level == 1:
            sys.stdout = self
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Each time we exit a 'with' block, decrease the level
        self.level -= 1
        # If we have exited all blocks, restore original stdout
        if self.level == 0:
            sys.stdout = self.original_stdout
            
    def __call__(self, iterable):
        """
        Called when the instance is used like a function, e.g., nest(my_list).
        This is a generator that wraps an iterable.
        """
        # Increase indentation before the loop starts
        self.__enter__()
        try:
            # Yield each item from the original iterable
            for item in iterable:
                yield item
        finally:
            # Decrease indentation after the loop finishes (or breaks)
            self.__exit__(None, None, None)

    def write(self, text):
        """
        The custom write method that adds indentation.
        `print()` will call this method.
        """
        # We only add the prefix to lines that are not empty
        if text.strip():
            self.original_stdout.write(self.indent_string * self.level + text)
        else:
            self.original_stdout.write(text)

    def flush(self):
        """A passthrough for the flush method."""
        self.original_stdout.flush()
        
    def dump(self):
        if self.buffer:
            sys.stdout = self.saved_stdout
            return self.original_stdout.getvalue()
        return ""