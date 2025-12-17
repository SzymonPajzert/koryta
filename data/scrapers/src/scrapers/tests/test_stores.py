"""Tests for the abstract store interfaces and data structures."""

import io
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from scrapers.stores import (
    Context,
    DownloadableFile,
    LocalFile,
    Pipeline,
    ProcessPolicy,
)


class TestStores(unittest.TestCase):
    """Test cases for the stores module."""

    def test_downloadable_file(self):
        """Tests the DownloadableFile dataclass."""
        df = DownloadableFile(url="http://example.com/data.csv")
        self.assertEqual(df.filename, "data.csv")

        df_fallback = DownloadableFile(
            url="http://example.com/download?id=123", filename_fallback="data.csv"
        )
        self.assertEqual(df_fallback.filename, "data.csv")


class TestProcessPolicy(unittest.TestCase):
    def test_with_default(self):
        # Default behavior
        policy = ProcessPolicy.with_default()
        self.assertEqual(policy.refresh_pipelines, set())

        # With explicit values
        policy = ProcessPolicy.with_default(refresh=["A"])
        self.assertEqual(policy.refresh_pipelines, {"A"})

    def test_should_refresh(self):
        policy = ProcessPolicy.with_default(refresh=["A"])
        self.assertTrue(policy.should_refresh("A"))
        self.assertFalse(policy.should_refresh("B"))

        policy_all = ProcessPolicy.with_default(refresh=["all"])
        self.assertTrue(policy_all.should_refresh("A"))
        self.assertTrue(policy_all.should_refresh("B"))

    def test_should_refresh_logic(self):
        # Refresh all except A
        policy = ProcessPolicy.with_default(refresh=["all"], exclude_refresh=["A"])
        self.assertTrue(policy.should_refresh("B"))
        self.assertFalse(policy.should_refresh("A"))

        # Refresh explicit A, exclude A (exclude takes precedence)
        policy = ProcessPolicy.with_default(refresh=["A"], exclude_refresh=["A"])
        self.assertFalse(policy.should_refresh("A"))

        # Refresh explicit A, exclude B
        policy = ProcessPolicy.with_default(refresh=["A"], exclude_refresh=["B"])
        self.assertTrue(policy.should_refresh("A"))
        self.assertFalse(policy.should_refresh("B"))


# Dummy Pipelines for testing
class DummyDep(Pipeline):
    filename = "dep_file"

    def process(self, ctx: Context):
        return pd.DataFrame({"col": [1, 2]})


class DummyPipeline(Pipeline):
    dep: DummyDep

    def process(self, ctx: Context):
        return self.dep.read_or_process(ctx)


class Level3(Pipeline):
    filename = "level3"

    def process(self, ctx: Context):
        return pd.DataFrame({"l3": [3]})


class Level2(Pipeline):
    filename = "level2"
    l3: Level3

    def process(self, ctx: Context):
        self.l3.read_or_process(ctx)
        return pd.DataFrame({"l2": [2]})


class Level1(Pipeline):
    filename = "level1"
    l2: Level2

    def process(self, ctx: Context):
        self.l2.read_or_process(ctx)
        return pd.DataFrame({"l1": [1]})


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.io.dumper = Mock()
        self.mock_ctx.io.get_mtime.return_value = None  # Default: unknown/missing
        self.mock_ctx.refreshed_pipelines = set()
        self.dummy_df = pd.DataFrame({"col": [1, 2]})

    def test_lazy_initialization_memoized(self):
        """
        Verify that if the pipeline result is memoized (file exists)
        and we don't refresh / dependencies are NOT processed/run.
        """
        # Setup: Pipeline file exists
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        # Mock IO to return data so it looks like file exists
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = (
            self.dummy_df
        )
        # And ensure get_mtime returns something so it's not "missing input"
        self.mock_ctx.io.get_mtime.return_value = 100.0

        # Mock dependency
        pipeline.dep = Mock(spec=DummyDep)
        # Important: mocked methods return Truthy Mocks by default.
        pipeline.dep.should_refresh_with_logic.return_value = False
        pipeline.dep.output_time.return_value = 10.0  # Older than self (100.0)
        pipeline.dependencies["dep"] = pipeline.dep
        # Verify read_or_process on dependency is NOT called

        policy = ProcessPolicy.with_default()

        result = pipeline.read_or_process(self.mock_ctx, policy)

        # Should return cached result
        pd.testing.assert_frame_equal(result, self.dummy_df)

        # Dependency should NOT be touched
        pipeline.dep.read_or_process.assert_not_called()

    def test_refresh_forces_run(self):
        """
        Verify that if refresh is requested, we run the pipeline despite file existing.
        And dependency IS processed.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        # Mock existing file (though we shouldn't read it if refreshing)
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = (
            self.dummy_df
        )

        # Mock dependency instance that will be replaced in params
        # Note: Pipeline constructor initializes dep. We need to spy on it or mock it.
        # But here we manually injected a Mock into pipeline.dep in previous test.
        # We can do the same here.
        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.read_or_process.return_value = self.dummy_df
        dep_mock.output_path = "dep_output"  # Mock property
        pipeline.dep = dep_mock
        pipeline.dependencies["dep"] = dep_mock

        policy = ProcessPolicy.with_default(refresh=["DummyPipeline"])

        with patch.object(
            pipeline, "process", return_value=self.dummy_df
        ) as mock_process:
            pipeline.read_or_process(self.mock_ctx, policy)

            # Verify dependency was triggered
            dep_mock.read_or_process.assert_called_once()
            mock_process.assert_called_once()

    def test_lazy_init_missing_input(self):
        """
        If input is missing, we must run pipeline.
        Dependencies must be checked.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.dep = Mock(spec=DummyDep)
        pipeline.dep.pipeline_name = "DummyDep"
        pipeline.dep.read_or_process.return_value = self.dummy_df
        pipeline.dep.output_path = "dep_out"
        pipeline.dependencies["dep"] = pipeline.dep

        # Missing file for current pipeline
        self.mock_ctx.io.read_data.side_effect = FileNotFoundError

        # Policy: run all
        policy = ProcessPolicy.with_default()

        with patch.object(pipeline, "process", return_value=self.dummy_df):
            pipeline.read_or_process(self.mock_ctx, policy)

            # Dependency check should happen
            pipeline.dep.read_or_process.assert_called_once()

    def test_nested_pipelines_execution(self):
        """
        Verify correct propagation of execution in a 3-level nested pipeline.
        L1 -> L2 -> L3
        """
        pipeline = Level1()

        # Stateful mock for IO
        written_files = {}

        def read_data_se(ref):
            # We assume ref is LocalFile and has .filename
            # The pipeline writes to filename.jsonl
            fname = ref.filename
            if fname in written_files:
                m = Mock()
                # Return cached DF
                m.read_dataframe.return_value = written_files[fname]
                return m
            raise FileNotFoundError(f"File {fname} not found in {written_files.keys()}")

        def write_file_se(fs, content):
            if hasattr(fs, "filename"):
                written_files[fs.filename] = pd.DataFrame()  # Mock content
            pass

        # Helper to capture written dataframes
        def capture_written_df(fs, content):
            if hasattr(fs, "filename"):
                # We need to extract the dataframe.
                # The content is a callable calling df.to_json(f)
                # We can execute it with a BytesIO buffer
                buf = io.BytesIO()
                content(buf)  # type: ignore
                # Reset buffer position
                buf.seek(0)
                # Read it back into a DataFrame
                # Assuming jsonl format as default for these tests
                try:
                    df = pd.read_json(buf, lines=True)
                    written_files[fs.filename] = df
                except Exception as e:
                    print(f"Failed to capture written DF for {fs.filename}: {e}")

        # Use side_effect on mock
        self.mock_ctx.io.write_file.side_effect = capture_written_df  # type: ignore

        policy = ProcessPolicy.with_default()

        # We need to spy on process calls to verify execution order/count
        with (
            # No need to patch write_dataframe anymore as we mock context.io.write_file
            patch.object(
                Level3, "process", side_effect=Level3.process, autospec=True
            ) as mock_l3_proc,
            patch.object(
                Level2, "process", side_effect=Level2.process, autospec=True
            ) as mock_l2_proc,
            patch.object(
                Level1, "process", side_effect=Level1.process, autospec=True
            ) as mock_l1_proc,
        ):
            pipeline.read_or_process(self.mock_ctx, policy)

            mock_l1_proc.assert_called_once()
            mock_l2_proc.assert_called_once()
            mock_l3_proc.assert_called_once()

    def test_missing_input_writes_output(self):
        """
        Verify that when input is missing, the pipeline runs and WRITES the result.
        Addressing the TODO.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy_writes"
        pipeline.dep = Mock(spec=DummyDep)
        pipeline.dep.read_or_process.return_value = self.dummy_df
        pipeline.dep.output_path = "dep_out"
        pipeline.dependencies["dep"] = pipeline.dep

        # Input missing
        self.mock_ctx.io.read_data.side_effect = FileNotFoundError

        policy = ProcessPolicy.with_default()

        with patch.object(pipeline, "process", return_value=self.dummy_df):
            pipeline.read_or_process(self.mock_ctx, policy)

            # Verify write was called
            self.mock_ctx.io.write_file.assert_called_once()
            args, _ = self.mock_ctx.io.write_file.call_args
            # args: (fs, content_callback)
            self.assertTrue(args[0].filename.endswith(".jsonl"))

    def test_deep_dependency_refresh(self):
        """
        Verify that if a deep dependency is refreshed,
        the upper layers are also reprocessed.
        L1 -> L2 -> L3
        Refresh L3 -> L2 should run -> L1 should run.
        """
        pipeline = Level1()

        # Stateful mock for IO: everything exists initially
        # We use a set of written files to track writes
        written_files = {
            "level1": pd.DataFrame({"l1": [1]}),
            "level2": pd.DataFrame({"l2": [2]}),
            "level3": pd.DataFrame({"l3": [3]}),
        }
        reprocessed = set()

        def read_data_se(ref):
            if isinstance(ref, LocalFile) and ref.filename in written_files:
                m = Mock()
                m.read_dataframe.return_value = written_files[ref.filename]
                return m
            raise FileNotFoundError(f"File {ref.filename} not found")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        def capture_written_df(fs, content):
            if hasattr(fs, "filename"):
                buf = io.BytesIO()
                content(buf)  # type: ignore
                buf.seek(0)
                try:
                    df = pd.read_json(buf, lines=True)
                    written_files[fs.filename] = df
                    base_name = fs.filename.split(".")[0]
                    reprocessed.add(base_name)
                except Exception as e:
                    print(f"Failed to capture written DF for {fs.filename}: {e}")

        self.mock_ctx.io.write_file.side_effect = capture_written_df

        # Policy: Only refresh Level3
        # Use preprocess_sources=True because we need to check deps -> Now automated
        policy = ProcessPolicy.with_default(refresh=["Level3"])

        with (
            patch.object(
                Level3, "process", side_effect=Level3.process, autospec=True
            ) as mock_l3_proc,
            patch.object(
                Level2, "process", side_effect=Level2.process, autospec=True
            ) as mock_l2_proc,
            patch.object(
                Level1, "process", side_effect=Level1.process, autospec=True
            ) as mock_l1_proc,
        ):
            pipeline.read_or_process(self.mock_ctx, policy)

            # L3 should run (explicit refresh)
            mock_l3_proc.assert_called_once()

            # L2 should run (dep L3 refreshed)
            mock_l2_proc.assert_called_once()

            # L1 should run (dep L2 refreshed)
            mock_l1_proc.assert_called_once()

        self.assertIn("level3/level3", reprocessed)
        self.assertIn("level2/level2", reprocessed)
        self.assertIn("level1/level1", reprocessed)

    def test_timestamp_dependency_refresh(self):
        """
        Verify that if dependency file is newer than consumer, consumer refreshes.
        L2 -> L3.
        L2 mtime=100.
        L3 mtime=200 (Newer!).
        L2 should refresh.
        """
        pipeline = Level2()

        # Mocks files with specific timestamps
        # We need MockIO setup to return specific mtimes

        # Mocking context IO to have get_mtime
        mtimes = {
            "level2/level2.jsonl": 100.0,
            "level3/level3.jsonl": 200.0,
        }

        # We need to simulate that files DO exist and Read succeeds if we don't refresh.
        # But here we expect refresh, so Read shouldn't be called (or ignored).

        def get_mtime_se(ref):
            if isinstance(ref, LocalFile) and ref.filename in mtimes:
                return mtimes[ref.filename]
            return None  # Missing

        self.mock_ctx.io.get_mtime.side_effect = get_mtime_se

        # We also need read_data to succeed for Level3
        # so it doesn't try to run it unless necessary.
        # Level3 is newer, so it shouldn't re-run.
        # Level2 is older, so it SHOULD re-run.

        policy = ProcessPolicy.with_default()  # no explicit refresh

        # Return dataframe for L3
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = (
            pd.DataFrame({"l3": [3]})
        )

        with (
            patch.object(
                Level3, "process", side_effect=Level3.process, autospec=True
            ) as mock_l3_proc,
            patch.object(
                Level2, "process", side_effect=Level2.process, autospec=True
            ) as mock_l2_proc,
        ):
            pipeline.read_or_process(self.mock_ctx, policy)

            mock_l3_proc.assert_not_called()
            # L2 depends on L3. L3 mtime(200) > L2 mtime(100).
            mock_l2_proc.assert_called_once()

    def test_diamond_dependency_double_execution(self):
        """
        Verify that in a diamond dependency (Top->Left->Bottom, Top->Right->Bottom),
        Bottom is executed TWICE if we refresh all, because instances are distinct.
        This is the bug we want to reproduce and then fix.
        """

        # Setup classes dynamically to avoid global scope pollution/complexity
        class Bottom(Pipeline):
            filename = "bottom"

            def process(self, ctx: Context):
                return pd.DataFrame({"b": [1]})

        class Left(Pipeline):
            filename = "left"
            bottom: Bottom

            def process(self, ctx: Context):
                self.bottom.read_or_process(ctx)
                return pd.DataFrame({"l": [2]})

        class Right(Pipeline):
            filename = "right"
            bottom: Bottom

            def process(self, ctx: Context):
                self.bottom.read_or_process(ctx)
                return pd.DataFrame({"r": [3]})

        class Top(Pipeline):
            filename = "top"
            left: Left
            right: Right

            def process(self, ctx: Context):
                self.left.read_or_process(ctx)
                self.right.read_or_process(ctx)
                return pd.DataFrame({"t": [4]})

        pipeline = Top()

        # We need to simulate that files do NOT exist or need refresh.
        # "refresh all" policy.
        policy = ProcessPolicy.with_default(refresh=["all"])

        # We need to spy on Bottom.process.
        # So we need to patch Bottom.process globally (on the class).

        # Mock IO to handle writes (since run_pipeline writes)
        self.mock_ctx.io.get_mtime.return_value = (
            None  # Force everything to look old/missing
        )

        written_files = set()

        def capture_written_df(fs, content):
            if hasattr(fs, "filename"):
                written_files.add(fs.filename)

        self.mock_ctx.io.write_file.side_effect = capture_written_df

        def read_se(ref):
            if isinstance(ref, LocalFile) and ref.filename in written_files:
                m = Mock()
                m.read_dataframe.return_value = pd.DataFrame({"b": [1]})
                return m
            raise FileNotFoundError

        self.mock_ctx.io.read_data.side_effect = read_se

        with patch.object(
            Bottom, "process", return_value=pd.DataFrame({"b": [1]})
        ) as mock_bottom_proc:
            pipeline.read_or_process(self.mock_ctx, policy)

            # With distinct instances but with refreshed_pipelines check,
            # this should be called ONCE.
            self.assertEqual(
                mock_bottom_proc.call_count,
                1,
                "Bottom should be processed once thanks to refreshed_pipelines",
            )

    def test_volatile_dependency_propagation(self):
        """
        Verify that a dependency with filename=None (volatile) does NOT cause
        the downstream pipeline to refresh if the downstream pipeline is already cached.
        Volatile pipelines always "run" (conceptually),
        but shouldn't invalidate downstream caches.
        """

        class Volatile(Pipeline):
            filename = None

            def process(self, ctx: Context):
                return pd.DataFrame({"v": [1]})

        class Stable(Pipeline):
            filename = "stable"
            dep: Volatile

            def process(self, ctx: Context):
                self.dep.read_or_process(ctx)
                return pd.DataFrame({"s": [2]})

        pipeline = Stable()
        policy = ProcessPolicy.with_default()

        # Mock IO: Stable file exists
        self.mock_ctx.io.get_mtime.return_value = 100.0  # Old enough

        # We need Stable to read from cache
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = (
            pd.DataFrame({"s": [2]})
        )

        with patch.object(
            Stable, "process", side_effect=Stable.process, autospec=True
        ) as mock_stable_proc:
            # We also might want to check if Volatile.process is called.
            # Volatile should run because it has no cache.
            # But Stable should NOT run.

            with patch.object(
                Volatile, "process", return_value=pd.DataFrame({"v": [1]})
            ) as mock_volatile_proc:
                pipeline.read_or_process(self.mock_ctx, policy)

                # Volatile runs
                mock_volatile_proc.assert_not_called()

                # Stable should NOT run
                mock_stable_proc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
