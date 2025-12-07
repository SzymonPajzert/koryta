"""Tests for the abstract store interfaces and data structures."""

import unittest

from scrapers.stores import (
    CloudStorage,
    DownloadableFile,
    FirestoreCollection,
    LocalFile,
    ProcessPolicy,
    Pipeline,
    Context,
)
from unittest.mock import Mock, patch
import pandas as pd


class TestStores(unittest.TestCase):
    """Test cases for the stores module."""

    def test_downloadable_file(self):
        """Tests the DownloadableFile dataclass."""
        df = DownloadableFile(url="http://example.com/data.csv")
        self.assertEqual(df.filename, "data.csv")

        df_fallback = DownloadableFile(url="http://example.com/download?id=123", filename_fallback="data.csv")
        self.assertEqual(df_fallback.filename, "data.csv")

    def test_dataref_classes(self):
        """Tests the simple DataRef dataclasses."""
        local = LocalFile("file.txt", "tests")
        self.assertEqual(local.filename, "file.txt")

        firestore = FirestoreCollection("users", filters=[("age", ">", 18)])
        self.assertEqual(firestore.collection, "users")
        self.assertEqual(firestore.filters, [("age", ">", 18)])

        gcs = CloudStorage("my-bucket")
        self.assertEqual(gcs.hostname, "my-bucket")


class TestProcessPolicy(unittest.TestCase):
    def test_with_default(self):
        # Default behavior
        policy = ProcessPolicy.with_default()
        self.assertEqual(policy.refresh_pipelines, set())
        self.assertEqual(policy.run_pipelines, {"all"})

        # With explicit values
        policy = ProcessPolicy.with_default(refresh=["A"], only=["B"])
        self.assertEqual(policy.refresh_pipelines, {"A"})
        self.assertEqual(policy.run_pipelines, {"B"})

    def test_should_refresh(self):
        policy = ProcessPolicy.with_default(refresh=["A"], only=[])
        self.assertTrue(policy.should_refresh("A"))
        self.assertFalse(policy.should_refresh("B"))

        policy_all = ProcessPolicy.with_default(refresh=["all"], only=[])
        self.assertTrue(policy_all.should_refresh("A"))
        self.assertTrue(policy_all.should_refresh("B"))

    def test_should_run(self):
        # Default runs all
        policy = ProcessPolicy.with_default()
        self.assertTrue(policy.should_run("A"))

        # Specific run
        policy = ProcessPolicy.with_default(refresh=[], only=["A"])
        self.assertTrue(policy.should_run("A"))
        self.assertFalse(policy.should_run("B"))

        # Refresh implies run
        policy = ProcessPolicy.with_default(refresh=["A"], only=["B"])
        self.assertTrue(policy.should_run("A"))
        self.assertTrue(policy.should_run("B"))
        self.assertFalse(policy.should_run("C"))


# Dummy Pipelines for testing
class DummyDep(Pipeline):
    def process(self, ctx: Context):
        return pd.DataFrame({"col": [1, 2]})

class DummyPipeline(Pipeline):
    dep: DummyDep

    def process(self, ctx: Context):
        return self.dep.process(ctx)

class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.io.dumper = Mock()
        self.dummy_df = pd.DataFrame({"col": [1, 2]})

    def test_lazy_initialization_memoized(self):
        """
        Verify that if the pipeline result is memoized (file exists) and we don't refresh,
        dependencies are NOT processed/run.
        """
        # Setup: Pipeline file exists
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        
        # Mock IO to return data so it looks like file exists
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = self.dummy_df
        
        # Mock dependency
        pipeline.dep = Mock(spec=DummyDep)
        # Verify read_or_process on dependency is NOT called
        
        policy = ProcessPolicy.with_default(refresh=[], only=[])
        
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
        self.mock_ctx.io.read_data.return_value.read_dataframe.return_value = self.dummy_df
        
        # Mock dependency instance that will be replaced in params
        # Note: Pipeline constructor initializes dep. We need to spy on it or mock it.
        # But here we manually injected a Mock into pipeline.dep in previous test.
        # We can do the same here.
        dep_mock = Mock(spec=DummyDep)
        dep_mock.pipeline_name = "DummyDep"
        dep_mock.read_or_process.return_value = self.dummy_df
        pipeline.dep = dep_mock
        
        policy = ProcessPolicy.with_default(refresh=["DummyPipeline"], only=[])
        
        with patch.object(pipeline, 'process', return_value=self.dummy_df) as mock_process:
            pipeline.read_or_process(self.mock_ctx, policy)
            
            # Verify dependency was triggered
            dep_mock.read_or_process.assert_called_once()
            mock_process.assert_called_once()

    def test_run_only_logic(self):
        """
        Verify 'only' constraints.
        If we run 'only=["DummyPipeline"]', dependency is NOT in 'only'.
        But dependency should still proceed if checked.
        However, if dependency file is missing, does it crash?
        """
        pipeline = DummyPipeline()
        pipeline.filename = "dummy"
        dep = DummyDep()
        dep.filename = "dep_file"
        pipeline.dep = dep
        
        # Mock IO to throw FileNotFoundError for both
        self.mock_ctx.io.read_data.side_effect = FileNotFoundError
        
        # Mock process methods
        with patch.object(pipeline, 'process', return_value=self.dummy_df), \
             patch.object(dep, 'process', return_value=self.dummy_df):
            
            policy = ProcessPolicy.with_default(refresh=[], only=["DummyPipeline"])
            
            # This should fail if the bug exists (dep not in run causing read_or_process to return None)
            # Or if it asserts df is not None
            try:
                pipeline.read_or_process(self.mock_ctx, policy)
            except AssertionError:
                self.fail("Use of 'only' caused dependency failure when input missing")

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
        
        # Missing file for current pipeline
        self.mock_ctx.io.read_data.side_effect = FileNotFoundError
        
        # Policy: run all
        policy = ProcessPolicy.with_default()
        
        with patch.object(pipeline, 'process', return_value=self.dummy_df):
            pipeline.read_or_process(self.mock_ctx, policy)
            
            # Dependency check should happen
            pipeline.dep.read_or_process.assert_called_once()


if __name__ == "__main__":
    unittest.main()
