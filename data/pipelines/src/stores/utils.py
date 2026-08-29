import argparse
import io
import select
import sys
from functools import cache
from urllib.parse import urljoin

from scrapers.stores import Utils


@cache
def _args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--assume-yes",
        action="store_true",
        help="Answer yes to the 'this pipeline runs long' prompts instead of "
        "waiting on stdin. Required for unattended runs.",
    )
    return parser.parse_known_args()[0]


class UtilsImpl(Utils):
    def input_with_timeout(self, msg: str, timeout: int = 10) -> str | None:
        # Without this an unattended run reads EOF from /dev/null, takes it as
        # "no", and skips every confirm_run pipeline -- silently, and long
        # before anything gets a chance to fail.
        if _args().assume_yes:
            print(f"{msg} -- answering y (--assume-yes)")
            return "y"

        print(msg)
        sys.stdout.flush()

        # `select` needs a real file descriptor, and there is not always one.
        # Under pytest `sys.stdin` is a `DontReadFromInput` whose `fileno()`
        # raises `io.UnsupportedOperation`; the same is true of a notebook
        # kernel, and `sys.stdin` is None outright under pythonw. Letting that
        # propagate turned "nobody is here to answer" into an exception thrown
        # from inside `should_refresh_with_logic`, which `preprocess_sources`
        # re-raises - so one unanswerable prompt killed the whole dependency
        # run rather than declining the pipeline it was asking about. That is
        # how 53 of the 55 failures in `src/tests` began, all of them reported
        # as `io.UnsupportedOperation: redirected stdin is pseudofile`, which
        # names the plumbing and not the question that could not be asked.
        #
        # An unaskable question gets the answer the timeout would have given:
        # None, which every caller reads as "no". That is the same conclusion
        # as the EOF-from-/dev/null case the comment above describes, and
        # `--assume-yes` remains the way to say yes without a terminal.
        try:
            readable, _, _ = select.select([sys.stdin], [], [], timeout)
        except (OSError, ValueError, io.UnsupportedOperation, TypeError):
            print(f"{msg} -- no readable stdin, taking it as n")
            return None

        if readable:
            return sys.stdin.readline().strip()
        else:
            return None

    def join_url(self, base: str, url: str) -> str:
        return urljoin(base, url)
