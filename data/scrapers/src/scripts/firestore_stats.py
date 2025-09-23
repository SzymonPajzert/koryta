from stores.firestore import path_occurrence
from tabulate import tabulate

if __name__ == "__main__":
    path_stats_raw, analysis, collections, _ = path_occurrence()

    path_stats = [
        [path, stat.present / stat.total, stat.present, stat.total]
        for path, stat in path_stats_raw.items()
    ]
    print(tabulate(path_stats, headers=["Path", "Presence", "Present", "Total"]))
    print()
    print(analysis)

    # TODO check that nodes[blob] has text or has url
