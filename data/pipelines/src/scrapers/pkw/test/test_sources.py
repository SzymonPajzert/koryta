from scrapers.pkw.sources import ZipExtractor, sources


def test_no_file_is_read_twice():
    # The 1998 small-gmina workbooks were once registered sixteen times over
    # one inner file, which read dolnośląskie sixteen times and nothing else.
    def read(source):
        extractor = source.extractor
        if isinstance(extractor, ZipExtractor):
            return (source.source.filename, extractor.inner_filename, extractor.index)
        return (source.source.filename, None, None)

    reads = [read(s) for s in sources]

    assert len(reads) == len(set(reads))
