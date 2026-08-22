"""Tests for the abstract store interfaces and data structures."""

import io
import os
import tempfile
import unittest
from typing import Any
from unittest.mock import Mock, patch

import pandas as pd

from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.stores import (
    Context,
    LocalFile,
    Pipeline,
    ProcessPolicy,
    Selection,
)
from scrapers.stores.file import DownloadableFile, VersionedBackup


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


class TestSelection(unittest.TestCase):
    def test_parse_splits_on_the_colon_prefix(self):
        selection = Selection.parse(["A", ":B", " C ", "", ":all"])
        self.assertEqual(selection.selected, {"A", "C"})
        self.assertEqual(selection.deselected, {"B", "all"})

    def test_unnamed_pipelines_take_the_default(self):
        selection = Selection.parse(["A"])
        self.assertTrue(selection.decide("A", default=False))
        self.assertFalse(selection.decide("B", default=False))
        self.assertTrue(selection.decide("B", default=True))

    def test_all_and_colon_all(self):
        self.assertTrue(Selection.parse(["all"]).decide("A", default=False))
        self.assertFalse(Selection.parse([":all"]).decide("A", default=True))

    def test_deselection_wins(self):
        # ...whichever order the flags came in, and even against 'all'.
        self.assertFalse(Selection.parse(["A", ":A"]).decide("A", default=True))
        self.assertFalse(Selection.parse(["all", ":A"]).decide("A", default=True))
        self.assertTrue(Selection.parse(["all", ":A"]).decide("B", default=False))


class TestProcessPolicy(unittest.TestCase):
    def test_with_default(self):
        # Default behavior
        policy = ProcessPolicy.with_default()
        self.assertEqual(policy.refresh.selected, set())

        # With explicit values
        policy = ProcessPolicy.with_default(refresh=["A"])
        self.assertEqual(policy.refresh.selected, {"A"})

    def test_should_refresh(self):
        policy = ProcessPolicy.with_default(refresh=["A"])
        self.assertTrue(policy.should_refresh("A"))
        self.assertFalse(policy.should_refresh("B"))

        policy_all = ProcessPolicy.with_default(refresh=["all"])
        self.assertTrue(policy_all.should_refresh("A"))
        self.assertTrue(policy_all.should_refresh("B"))

    def test_should_refresh_logic(self):
        # Refresh all except A
        policy = ProcessPolicy.with_default(refresh=["all", ":A"])
        self.assertTrue(policy.should_refresh("B"))
        self.assertFalse(policy.should_refresh("A"))

        # Refresh explicit A, exclude A (exclude takes precedence)
        policy = ProcessPolicy.with_default(refresh=["A", ":A"])
        self.assertFalse(policy.should_refresh("A"))

        # Refresh explicit A, exclude B
        policy = ProcessPolicy.with_default(refresh=["A", ":B"])
        self.assertTrue(policy.should_refresh("A"))
        self.assertFalse(policy.should_refresh("B"))

    @patch("scrapers.stores.backup_disabled", return_value=True)
    def test_disable_backup_env_deselects_both_directions(self, _mock_disabled):
        """DISABLE_BACKUP is folded in as ':all', so it beats --read-backup."""
        policy = ProcessPolicy.with_default(read_backup=["all"], write_backup=["A"])
        self.assertFalse(policy.read_backup.decide("A", default=True))
        self.assertFalse(policy.write_backup.decide("A", default=True))


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
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default()
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

        result = pipeline.read_or_process(self.mock_ctx)

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
        # VersionedBackup reads should fail (no GCS in tests)
        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                raise FileNotFoundError(f"No backup for {ref.filename}")
            m = Mock()
            m.read_dataframe.return_value = self.dummy_df
            return m

        self.mock_ctx.io.read_data.side_effect = read_data_se

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

        with patch.object(
            pipeline, "process", return_value=self.dummy_df
        ) as mock_process:
            pipeline.read_or_process(self.mock_ctx)

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

        with patch.object(pipeline, "process", return_value=self.dummy_df):
            pipeline.read_or_process(self.mock_ctx)

            # Dependency check should happen
            pipeline.dep.read_or_process.assert_called_once()

    def _missing_output_pipeline(self):
        """A pipeline whose local output is missing (get_mtime -> None)."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.dep = Mock(spec=DummyDep)
        pipeline.dep.pipeline_name = "DummyDep"
        pipeline.dep.read_or_process.return_value = self.dummy_df
        pipeline.dep.output_path = "dep_out"
        pipeline.dependencies["dep"] = pipeline.dep
        return pipeline

    def test_missing_output_restores_from_backup(self):
        """
        Baseline: with backups enabled, a missing local output is restored from
        the versioned backup instead of being reprocessed.
        """
        pipeline = self._missing_output_pipeline()
        stale_df = pd.DataFrame({"col": [9, 9]})

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                m = Mock()
                m.read_dataframe.return_value = stale_df
                return m
            raise FileNotFoundError("no local output")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        with patch.object(
            pipeline, "process", return_value=self.dummy_df
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

        # Restored from backup, pipeline NOT reprocessed.
        mock_process.assert_not_called()
        pd.testing.assert_frame_equal(result, stale_df)

    def test_no_backup_skips_restore_and_reprocesses(self):
        """
        With reads deselected, a missing local output must be recomputed from
        source rather than restored from the shared backup (stale data).
        """
        pipeline = self._missing_output_pipeline()
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(
            read_backup=[":all"], write_backup=[":all"]
        )
        stale_df = pd.DataFrame({"col": [9, 9]})
        backup_reads = []

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                backup_reads.append(ref)
                m = Mock()
                m.read_dataframe.return_value = stale_df
                return m
            raise FileNotFoundError("no local output")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        with patch.object(
            pipeline, "process", return_value=self.dummy_df
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

        # Backup must never be read, and the pipeline is reprocessed.
        self.assertEqual(backup_reads, [])
        mock_process.assert_called_once()
        pd.testing.assert_frame_equal(result, self.dummy_df)

    def test_nested_pipelines_execution(self):
        """
        Verify correct propagation of execution in a 3-level nested pipeline.
        L1 -> L2 -> L3
        """
        pipeline = Level1()

        # Stateful mock for IO
        written_files: dict[str, Any] = {}

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                raise FileNotFoundError(f"No backup for {ref.filename}")
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
        self.mock_ctx.io.read_data.side_effect = read_data_se
        self.mock_ctx.io.write_file.side_effect = capture_written_df  # type: ignore

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
            pipeline.read_or_process(self.mock_ctx)

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

        with patch.object(pipeline, "process", return_value=self.dummy_df):
            pipeline.read_or_process(self.mock_ctx)

            # Verify write was called
            self.assertEqual(self.mock_ctx.io.write_file.call_count, 2)
            args, _ = self.mock_ctx.io.write_file.call_args_list[0]
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
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(refresh=["Level3"])

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
            pipeline.read_or_process(self.mock_ctx)

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
            pipeline.read_or_process(self.mock_ctx)

            mock_l3_proc.assert_not_called()
            # L2 depends on L3. L3 mtime(200) > L2 mtime(100).
            mock_l2_proc.assert_called_once()

    def test_deep_dependency_timestamp_refresh(self):
        """
        Verify that if the most upstream dependency (L3) is newer than others,
        all downstream pipelines (L2, L1) refresh.
        """
        pipeline = Level1()

        written_files = {
            "level1/level1.jsonl": pd.DataFrame({"l1": [1]}),
            "level2/level2.jsonl": pd.DataFrame({"l2": [2]}),
            "level3/level3.jsonl": pd.DataFrame({"l3": [3]}),
        }

        mtimes = {
            "level1/level1.jsonl": 100.0,
            "level2/level2.jsonl": 100.0,
            "level3/level3.jsonl": 200.0,  # Newer!
        }

        def read_data_se(ref):
            if isinstance(ref, LocalFile) and ref.filename in written_files:
                m = Mock()
                m.read_dataframe.return_value = written_files[ref.filename]
                return m
            raise FileNotFoundError(f"File {ref.filename} not found")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        def get_mtime_se(ref):
            if hasattr(ref, "filename") and ref.filename in mtimes:
                return mtimes[ref.filename]
            return None

        self.mock_ctx.io.get_mtime.side_effect = get_mtime_se

        def capture_written_df(fs, content):
            pass

        self.mock_ctx.io.write_file.side_effect = capture_written_df
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default()

        with (
            patch.object(
                Level3, "process", return_value=pd.DataFrame({"l3": [3]}), autospec=True
            ) as mock_l3_proc,
            patch.object(
                Level2, "process", return_value=pd.DataFrame({"l2": [2]}), autospec=True
            ) as mock_l2_proc,
            patch.object(
                Level1, "process", return_value=pd.DataFrame({"l1": [1]}), autospec=True
            ) as mock_l1_proc,
        ):
            pipeline.read_or_process(self.mock_ctx)

            # L3 should NOT run (it is up to date, has no dependencies)
            mock_l3_proc.assert_not_called()

            # L2 should run because its dependency L3 is newer (200 > 100)
            mock_l2_proc.assert_called_once()

            # L1 should run because its dependency L2 refreshed
            mock_l1_proc.assert_called_once()

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
            pipeline.read_or_process(self.mock_ctx)

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
            volatile = True

            def process(self, ctx: Context):
                return pd.DataFrame({"v": [1]})

        class Stable(Pipeline):
            filename = "stable"
            dep: Volatile

            def process(self, ctx: Context):
                self.dep.read_or_process(ctx)
                return pd.DataFrame({"s": [2]})

        pipeline = Stable()

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
                pipeline.read_or_process(self.mock_ctx)

                # Volatile runs
                mock_volatile_proc.assert_not_called()

                # Stable should NOT run
                mock_stable_proc.assert_not_called()

class TestVersionedBackupRestore(unittest.TestCase):
    """Tests for the versioned backup restore logic in read_or_process."""

    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.io.dumper = Mock()
        self.mock_ctx.io.get_mtime.return_value = None  # Missing local output
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default()
        self.backup_df = pd.DataFrame({"restored": [1, 2, 3]})

    def test_missing_output_restores_from_backup(self):
        """
        When local output is missing and a versioned backup exists,
        the pipeline should restore from backup without re-processing.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.output_time.return_value = None
        dep_mock.volatile = False
        pipeline.dep = dep_mock
        pipeline.dependencies["dep"] = dep_mock

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                m = Mock()
                m.read_dataframe.return_value = self.backup_df
                return m
            raise FileNotFoundError(f"No local file: {ref.filename}")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame()
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

            # Should NOT have called process
            mock_process.assert_not_called()

            # Should return the backup data
            pd.testing.assert_frame_equal(result, self.backup_df)

    def test_missing_output_restores_and_saves_locally(self):
        """
        When restoring from backup, the data should be written to the
        local versioned path (local_only=True) so next run finds it on disk.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.output_time.return_value = None
        dep_mock.volatile = False
        pipeline.dep = dep_mock
        pipeline.dependencies["dep"] = dep_mock

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                m = Mock()
                m.read_dataframe.return_value = self.backup_df
                return m
            raise FileNotFoundError(f"No local file: {ref.filename}")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        pipeline.read_or_process(self.mock_ctx)

        # write_file should have been called with a LocalFile (local save)
        # but NOT with a VersionedBackup (no re-upload)
        write_calls = self.mock_ctx.io.write_file.call_args_list
        local_writes = [
            c for c in write_calls if isinstance(c[0][0], LocalFile)
        ]
        backup_writes = [
            c for c in write_calls if isinstance(c[0][0], VersionedBackup)
        ]

        self.assertGreater(len(local_writes), 0, "Should write locally")
        self.assertEqual(
            len(backup_writes), 0, "Should NOT re-upload to backup"
        )

    def test_missing_output_backup_fails_falls_through_to_process(self):
        """
        When local output is missing AND versioned backup also fails,
        the pipeline should fall through to re-processing.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.read_or_process.return_value = pd.DataFrame({"dep": [1]})
        dep_mock.output_path = "dep_out"
        dep_mock.output_time.return_value = None
        dep_mock.volatile = False
        pipeline.dep = dep_mock
        pipeline.dependencies["dep"] = dep_mock

        # Both local and backup reads fail
        self.mock_ctx.io.read_data.side_effect = FileNotFoundError(
            "Nothing exists"
        )

        processed_df = pd.DataFrame({"processed": [42]})
        with patch.object(
            pipeline, "process", return_value=processed_df
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

            # Should have fallen through to process
            mock_process.assert_called_once()
            pd.testing.assert_frame_equal(result, processed_df)

    def test_explicit_refresh_skips_backup(self):
        """
        When refresh is explicitly requested via policy (not just 'missing output'),
        the pipeline should NOT try to restore from backup.
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.read_or_process.return_value = pd.DataFrame({"dep": [1]})
        dep_mock.output_path = "dep_out"
        dep_mock.output_time.return_value = None
        dep_mock.volatile = False
        pipeline.dep = dep_mock
        pipeline.dependencies["dep"] = dep_mock

        # Explicit refresh policy for this pipeline
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(
            refresh=["DummyPipeline"]
        )

        def read_data_se(ref):
            if isinstance(ref, VersionedBackup):
                # This should NOT be reached
                m = Mock()
                m.read_dataframe.return_value = self.backup_df
                return m
            raise FileNotFoundError("No local file")

        self.mock_ctx.io.read_data.side_effect = read_data_se

        processed_df = pd.DataFrame({"fresh": [99]})
        with patch.object(
            pipeline, "process", return_value=processed_df
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

            # Should process, NOT restore from backup
            mock_process.assert_called_once()
            pd.testing.assert_frame_equal(result, processed_df)


class TestSharedCacheHooks(unittest.TestCase):
    """Tests for the shared-cache hooks (restore/upload by path) on Pipeline."""

    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.io.dumper = Mock()
        self.mock_ctx.io.get_mtime.return_value = None
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default()
        self.backup_df = pd.DataFrame({"restored": [1, 2, 3]})

    def test_restore_output_from_shared_cache(self):
        """restore_output_from_shared_cache streams the backup to the local
        output path and reports success."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"

        with patch("scrapers.stores.VERSIONED_DIR", "/tmp/versioned"):
            ok = pipeline.restore_output_from_shared_cache(self.mock_ctx)

        self.assertTrue(ok)
        self.mock_ctx.io.restore_backup_to_path.assert_called_once_with(
            "dummy", "/tmp/versioned/dummy/dummy.jsonl"
        )

    def test_restore_output_from_shared_cache_failure(self):
        """A failed restore returns False and is not treated as success."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        self.mock_ctx.io.restore_backup_to_path.side_effect = FileNotFoundError(
            "no backup"
        )

        ok = pipeline.restore_output_from_shared_cache(self.mock_ctx)

        self.assertFalse(ok)

    def test_restore_output_skipped_when_reads_deselected(self):
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(read_backup=[":all"])

        ok = pipeline.restore_output_from_shared_cache(self.mock_ctx)

        self.assertFalse(ok)
        self.mock_ctx.io.restore_backup_to_path.assert_not_called()

    def test_upload_output_to_shared_cache(self):
        """upload_output_to_shared_cache streams the local output up, and only
        when the pipeline opts in via write_backup."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.write_backup = True

        with (
            patch("scrapers.stores.VERSIONED_DIR", "/tmp/versioned"),
            patch("os.path.exists", return_value=True),
        ):
            ok = pipeline.upload_output_to_shared_cache(self.mock_ctx)

        self.assertTrue(ok)
        self.mock_ctx.io.upload_backup_from_path.assert_called_once_with(
            "dummy", "/tmp/versioned/dummy/dummy.jsonl"
        )

    def test_upload_output_skipped_when_local_only(self):
        """Local-only pipelines (write_backup=False) never upload."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.write_backup = False

        ok = pipeline.upload_output_to_shared_cache(self.mock_ctx)

        self.assertFalse(ok)
        self.mock_ctx.io.upload_backup_from_path.assert_not_called()

    def test_upload_output_skipped_when_file_missing(self):
        """No local output, no upload."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.write_backup = True

        tmpdir = tempfile.mkdtemp()
        with patch("scrapers.stores.VERSIONED_DIR", tmpdir):
            ok = pipeline.upload_output_to_shared_cache(self.mock_ctx)

        self.assertFalse(ok)
        self.mock_ctx.io.upload_backup_from_path.assert_not_called()

    def test_upload_output_skipped_when_writes_deselected(self):
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.write_backup = True
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(write_backup=[":all"])

        ok = pipeline.upload_output_to_shared_cache(self.mock_ctx)

        self.assertFalse(ok)
        self.mock_ctx.io.upload_backup_from_path.assert_not_called()

    def test_read_backup_overrides_local_only(self):
        """--read-backup restores even when the pipeline is local-only."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.read_backup = pipeline.write_backup = False
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(
            read_backup=["DummyPipeline"]
        )

        with patch("scrapers.stores.VERSIONED_DIR", "/tmp/versioned"):
            ok = pipeline.restore_output_from_shared_cache(self.mock_ctx)

        self.assertTrue(ok)
        self.mock_ctx.io.restore_backup_to_path.assert_called_once()

    def test_read_backup_names_one_pipeline_only(self):
        """Naming one pipeline leaves the others on their own default."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.read_backup = pipeline.write_backup = False
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(
            read_backup=["SomeOtherPipeline"]
        )

        ok = pipeline.restore_output_from_shared_cache(self.mock_ctx)

        self.assertFalse(ok)
        self.mock_ctx.io.restore_backup_to_path.assert_not_called()

    def test_write_backup_overrides_local_only(self):
        """--write-backup uploads even when the pipeline is local-only."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        pipeline.read_backup = pipeline.write_backup = False
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(write_backup=["all"])

        tmpdir = tempfile.mkdtemp()
        with patch("scrapers.stores.VERSIONED_DIR", tmpdir):
            # create the local output file so the upload hook sees it
            os.makedirs(os.path.join(tmpdir, "dummy"), exist_ok=True)
            with open(os.path.join(tmpdir, "dummy", "dummy.jsonl"), "w") as f:
                f.write("{}")
            ok = pipeline.upload_output_to_shared_cache(self.mock_ctx)

        self.assertTrue(ok)
        self.mock_ctx.io.upload_backup_from_path.assert_called_once()

    def test_read_and_write_are_decided_separately(self):
        """The nightly's case: restore what is cached, publish nothing."""
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(write_backup=[":all"])

        self.assertTrue(pipeline.reads_shared_cache(self.mock_ctx))
        self.assertFalse(pipeline.writes_shared_cache(self.mock_ctx))


class TestIncrementalSharedCacheHooks(unittest.TestCase):
    """Tests for the incremental pipeline's read/write shared-cache hooks."""

    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.io.dumper = Mock()
        self.mock_ctx.io.get_mtime.return_value = None
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default()
        self.tmpdir = tempfile.mkdtemp()

    def _make_pipeline(self, shared_cache=True):
        class P(IncrementalJsonlPipeline):
            filename = "incremental_hook_test"

            def process(self, ctx):
                return pd.DataFrame()

        p = P()
        p.read_backup = p.write_backup = shared_cache
        return p

    @patch("scrapers.article.pipelines.incremental.VERSIONED_DIR",
        new_callable=lambda: "/tmp/irrelevant",
    )
    def test_missing_output_restores_instead_of_processing(self, _mock_dir):
        """With a missing local output and a backup available, an incremental
        pipeline restores from the shared cache instead of re-processing."""
        pipeline = self._make_pipeline()
        pipeline.restore_output_from_shared_cache = Mock(return_value=True)

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame()
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

        mock_process.assert_not_called()
        pipeline.restore_output_from_shared_cache.assert_called_once()
        self.assertEqual(result.shape, (0, 0))

    @patch("scrapers.article.pipelines.incremental.VERSIONED_DIR",
        new_callable=lambda: "/tmp/irrelevant",
    )
    def test_restore_failure_falls_through_to_processing(self, _mock_dir):
        """When the shared-cache restore fails, the incremental pipeline
        falls back to processing normally."""
        pipeline = self._make_pipeline()
        pipeline.restore_output_from_shared_cache = Mock(return_value=False)

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame({"col": [1]})
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

        mock_process.assert_called_once()
        pd.testing.assert_frame_equal(result, pd.DataFrame({"col": [1]}))

    @patch("scrapers.article.pipelines.incremental.VERSIONED_DIR",
        new_callable=lambda: "/tmp/irrelevant",
    )
    def test_successful_run_uploads_to_shared_cache(self, _mock_dir):
        """A successful incremental run publishes its output to the shared
        cache via the write hook."""
        pipeline = self._make_pipeline()
        # No backup available, so the run proceeds and then uploads.
        pipeline.restore_output_from_shared_cache = Mock(return_value=False)
        pipeline.upload_output_to_shared_cache = Mock(return_value=True)

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame({"col": [1]})
        ):
            pipeline.read_or_process(self.mock_ctx)

        pipeline.upload_output_to_shared_cache.assert_called_once()

    @patch("scrapers.article.pipelines.incremental.VERSIONED_DIR",
        new_callable=lambda: "/tmp/irrelevant",
    )
    def test_local_only_pipeline_does_not_restore_or_upload(self, _mock_dir):
        """Local-only incremental pipelines skip both shared-cache hooks."""
        pipeline = self._make_pipeline(shared_cache=False)

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame({"col": [1]})
        ) as mock_process:
            pipeline.read_or_process(self.mock_ctx)

        mock_process.assert_called_once()
        self.mock_ctx.io.restore_backup_to_path.assert_not_called()
        self.mock_ctx.io.upload_backup_from_path.assert_not_called()

    @patch("scrapers.article.pipelines.incremental.VERSIONED_DIR",
        new_callable=lambda: "/tmp/irrelevant",
    )
    def test_read_backup_restores_local_only_incremental(self, _mock_dir):
        """--read-backup all makes a local-only incremental pipeline restore
        from the shared cache instead of processing."""
        pipeline = self._make_pipeline(shared_cache=False)
        self.mock_ctx.refresh_policy = ProcessPolicy.with_default(read_backup=["all"])
        pipeline.restore_output_from_shared_cache = Mock(return_value=True)

        with patch.object(
            pipeline, "process", return_value=pd.DataFrame({"col": [1]})
        ) as mock_process:
            result = pipeline.read_or_process(self.mock_ctx)

        mock_process.assert_not_called()
        pipeline.restore_output_from_shared_cache.assert_called_once()
        self.assertEqual(result.shape, (0, 0))


if __name__ == "__main__":
    unittest.main()
