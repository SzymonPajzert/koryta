"""Shared scaffolding for the article pipelines.

They all follow the same shape — an "incremental JSONL writer with cache
reuse": read the existing output as a cache, write new rows to a `.tmp` through
the dumper, then atomically rename `.tmp` onto the final file. Only the middle
step (the prompt / cache-validity rule / compute) differs per pipeline, so that
lives in each pipeline's ``process()``; everything around it is here.
"""

from pathlib import Path
from typing import TypeVar

import pandas as pd

from scrapers.stores import VERSIONED_DIR, Context, Pipeline

T = TypeVar("T")


class IncrementalJsonlPipeline(Pipeline[T]):
    """Base for pipelines that stream large JSONL output incrementally.

    Subclasses set ``filename`` and implement ``process(ctx)`` (which should
    call ``self.prepare_temp_output()`` and write rows via the dumper). The
    output/temp paths follow ``VERSIONED_DIR/<filename>/<filename>.jsonl``.
    """

    # Exceptions caught so the partial output written so far is kept. Empty
    # means "don't catch" — Ctrl+C still flushes via the finally, then
    # propagates (the merge-only pipelines behave that way).
    interrupt_exceptions: tuple[type[BaseException], ...] = ()
    interrupt_note: str = "will save partial output"

    @property
    def final_output_path(self) -> Path:
        name = self.filename
        assert name is not None, "IncrementalJsonlPipeline requires a filename"
        return Path(VERSIONED_DIR) / name / f"{name}.jsonl"

    @property
    def temp_output_path(self) -> Path:
        return self.final_output_path.with_suffix(".jsonl.tmp")

    def prepare_temp_output(self) -> None:
        """Start a fresh, empty `.tmp` to stream rows into."""
        self.temp_output_path.parent.mkdir(parents=True, exist_ok=True)
        if self.temp_output_path.exists():
            self.temp_output_path.unlink()
        self.temp_output_path.write_text("", encoding="utf-8")

    def finalize_temp_output(self) -> None:
        """Atomically promote `.tmp` to the final output file."""
        if self.temp_output_path.exists():
            self.final_output_path.parent.mkdir(parents=True, exist_ok=True)
            self.temp_output_path.replace(self.final_output_path)

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        if not self.should_refresh_with_logic(ctx):
            # Avoid loading multi-GB output into pandas just to report success.
            self._cached_result = pd.DataFrame()
            return self._cached_result

        # Read hook: a missing local output can be restored from the shared
        # cache instead of re-processed. Streams to the final output path, so
        # it is safe for multi-GB files.
        decision = ctx.refresh_policy.execution_decisions.get(self.pipeline_name)
        if (
            decision
            and decision[1] == "missing output"
            and self.restore_output_from_shared_cache(ctx)
        ):
            self._cached_result = pd.DataFrame()
            ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
            return self._cached_result

        self.bind_requirements(ctx)
        self.preprocess_sources(ctx, ctx.refresh_policy)
        graceful = True
        try:
            df = self.process(ctx)
            self._refreshed_execution = True
        except self.interrupt_exceptions:
            print(f"Caught interrupt signal, {self.interrupt_note}")
            df = pd.DataFrame()
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                self.finalize_temp_output()
                # Write hook: publish the freshly finalized output to the
                # shared cache, if this pipeline opts in. Only on a successful
                # run -- interrupted partial output stays local.
                if self._refreshed_execution:
                    self.upload_output_to_shared_cache(ctx)
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = df
        return df
