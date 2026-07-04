import pandas as pd

from scrapers.stores import (
    IO,
    NLP,
    Context,
    Pipeline,
    ProcessPolicy,
    RejestrIO,
    Utils,
    Web,
)


class MockIO(IO):
    def read_data(self, fs):
        pass

    def list_files(self, path):
        pass

    def output_entity(self, entity, sort_by=[]):
        pass

    def write_file(self, fs, content):
        pass

    def upload(self, source, data, content_type, include_query=False, verbose=True):
        pass

    def batch_upload(
        self, source, data, content_type, include_query=False, verbose=True
    ) -> str:
        return ""

    def list_namespaces(self, ref, namespace):
        pass

    def get_mtime(self, fs):
        if "PipelineC" in fs.filename:
            return 100
        if "PipelineB" in fs.filename:
            return 150
        if "PipelineA" in fs.filename:
            return 200
        return 0

    def get_output(self, entity_type):
        pass


class MockRejestrIO(RejestrIO):
    def get_rejestr_io(self, url):
        pass


class MockUtils(Utils):
    def input_with_timeout(self, msg, timeout=10):
        return "y"

    def join_url(self, base, url):
        return base + url


class MockWeb(Web):
    def robot_txt_allowed(self, ctx, url, parsed_url, user_agent):
        return True


class MockNLP(NLP):
    def extract_ner_entities(self, text):
        pass

    def lemmatize(self, text_data):
        return text_data


class PipelineC(Pipeline):
    filename = "PipelineC"

    def process(self, ctx):
        return pd.DataFrame([{"c": 1}])

    @property
    def output_class(self):
        return dict


class PipelineB(Pipeline):
    filename = "PipelineB"
    dep_c: PipelineC

    def process(self, ctx):
        return pd.DataFrame([{"b": 1}])

    @property
    def output_class(self):
        return dict


class PipelineA(Pipeline):
    filename = "PipelineA"
    dep_b: PipelineB

    def process(self, ctx):
        return pd.DataFrame([{"a": 1}])

    @property
    def output_class(self):
        return dict


if __name__ == "__main__":
    ctx = Context(
        io=MockIO(),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(refresh=["PipelineC"]),
    )

    a = PipelineA()
    print("Testing read_or_process for PipelineA with refresh=['PipelineC']")
    a.read_or_process(ctx)
