# This file registers all conductor pipelines in this package

from analysis.people_pkw_merged import people_pkw_merged
from analysis.utils.names import names_count_by_region, first_name_freq
from analysis.people import people_merged

pipelines = [
    people_pkw_merged,
    names_count_by_region,
    first_name_freq,
    people_merged,
]

# TODO ask for the output to produce and its format
# If not specified, people_merged
# TODO remove the remaining binaries
