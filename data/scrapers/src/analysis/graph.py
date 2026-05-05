import typing

import networkx as nx
import pandas as pd

from analysis.people_pkw_merged import PeoplePKWMerged
from analysis.utils import committee_to_party
from scrapers.stores import Context, Pipeline


def flatten_parties(df):
    df["person_id"] = (
        (
            df["first_name"].fillna("")
            + " "
            + df["second_name"].fillna("")
            + " "
            + df["last_name"].fillna("")
        )
        .str.strip()
        .str.replace(r"\s+", " ", regex=True)
    )

    print("Flattening parties...")

    def extract_parties(group):
        row = group.iloc[0]
        name = row["person_id"]
        parties = list(set(e["party"].lower() for e in row["elections"] if e["party"]))
        return pd.DataFrame(
            {"person_id": [name] * len(parties), "subgroup_id": parties}
        )

    flattened = df.groupby("person_id", group_keys=False).apply(extract_parties)
    flattened.reset_index(inplace=True)

    print("Done.")

    return flattened


class PeopleParties(Pipeline):
    """
    PeopleParties maps people to political parties based
    on other people's political associations.
    """

    filename = "people_parties"
    people_pkw_merged: PeoplePKWMerged

    def process(self, ctx: Context):
        df = self.people_pkw_merged.read_or_process(ctx)
        df = flatten_parties(df)

        print(df[:10])

        committes_to_parties = pd.DataFrame.from_records(
            [(committee, party) for committee, party in committee_to_party.items()],
            columns=["subgroup_id", "group_id"],
        )
        print(committes_to_parties[:10])

        result = calculate_ppr_scores(df, committes_to_parties)
        print(result[:10])
        return result


class CommitteeParties(Pipeline):
    filename = "committee_parties"
    people_pkw_merged: PeoplePKWMerged

    def process(self, ctx: Context):
        df = self.people_pkw_merged.read_or_process(ctx)
        df = flatten_parties(df)

        print(df[:10])

        committes_to_parties = pd.DataFrame.from_records(
            [(committee, party) for committee, party in committee_to_party.items()],
            columns=["subgroup_id", "group_id"],
        )
        print(committes_to_parties[:10])

        result = calculate_ppr_scores(
            df, committes_to_parties, measured_id="subgroup_id"
        )
        print(result[:10])
        return result


def calculate_ppr_scores(
    df_people_subgroups: pd.DataFrame,
    df_subgroups_groups: pd.DataFrame,
    measured_id: typing.Literal["person_id", "subgroup_id"] = "person_id",
    alpha: float = 0.85,
    normalize_rows: bool = True,
):
    """
    Calculates the probability score for each person belonging to each group
    using Personalized PageRank.

    Args:
        df_people_subgroups: DataFrame with columns ['person_id', 'subgroup_id']
        df_subgroups_groups: DataFrame with columns ['subgroup_id', 'group_id']
        alpha: The damping parameter for PageRank (default is 0.85).

    Returns:
        pd.DataFrame: A DataFrame where the index is 'person_id', columns
                      are 'group_id', and values are the 0-to-1 normalized scores.
    """

    print("Building the graph...")
    # 1. Create a directed graph
    G: nx.DiGraph = nx.DiGraph()

    # We must add prefixes to node IDs to prevent collisions
    def p_node(pid):
        return f"p_{pid}"

    def s_node(sid):
        return f"s_{sid}"

    def g_node(gid):
        return f"g_{gid}"

    # 2. Build the reversed graph structure

    # Add 'Group -> Subgroup' edges
    for _, row in df_subgroups_groups.iterrows():
        G.add_edge(g_node(row["group_id"]), s_node(row["subgroup_id"]))

    # Add 'Subgroup <-> Person' edges (bi-directional)
    # This allows influence to flow from S->P and also P->S,
    # which is crucial for your indirect connection (P1 -> S1 -> P2 -> S2)
    for _, row in df_people_subgroups.iterrows():
        person_id = p_node(row["person_id"])
        subgroup_id = s_node(row["subgroup_id"])
        G.add_edge(subgroup_id, person_id)  # S -> P
        G.add_edge(person_id, subgroup_id)  # P -> S

    # Get unique node lists for filtering later
    if measured_id == "person_id":
        measured_nodes = [
            p_node(pid) for pid in df_people_subgroups["person_id"].unique()
        ]
    elif measured_id == "subgroup_id":
        measured_nodes = [
            s_node(pid) for pid in df_people_subgroups["subgroup_id"].unique()
        ]
    group_nodes = [g_node(gid) for gid in df_subgroups_groups["group_id"].unique()]

    print(f"Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges.")
    print(f"Found {len(measured_nodes)} measured nodes and {len(group_nodes)} groups.")

    # 3. Run Personalized PageRank for each group
    all_scores = {}

    for i, group_node in enumerate(group_nodes):
        print(f"Calculating PPR for group {i + 1}/{len(group_nodes)} ({group_node})...")

        # Create the personalization vector
        # This vector tells PageRank to "teleport" back to our target group
        personalization = {node: 0 for node in G.nodes()}
        personalization[group_node] = 1

        # Run PageRank
        ppr_scores = nx.pagerank(
            G, alpha=alpha, personalization=personalization, nstart=personalization
        )

        # 4. Extract scores for *measured* nodes only
        group_results = {}
        for p_id in measured_nodes:
            # .get(p_id, 0) ensures a score of 0 if a person is
            # in a completely disconnected part of the graph
            group_results[p_id] = ppr_scores.get(p_id, 0)

        all_scores[group_node] = group_results

    # 5. Convert to DataFrame and Normalize
    print("Normalizing scores...")

    # Create the (Person x Group) score matrix
    df_scores = pd.DataFrame(all_scores)

    # Clean up the index and column names (remove 'p_' and 'g_')
    df_scores.index = df_scores.index.map(lambda x: x[2:])
    df_scores.columns = df_scores.columns.map(lambda x: x[2:])
    df_scores.index.name = measured_id
    df_scores.columns.name = "group_id"

    if normalize_rows:
        average_row = df_scores.sum().sum() / len(df_scores[df_scores.sum(axis=1) > 0])
        row_sums = df_scores.sum(axis=1)
        row_sums[row_sums == 0] = 1
        row_sums[row_sums < average_row] = average_row
        df_scores_normalized = df_scores.div(row_sums, axis=0)
        df_scores_normalized["original_sum"] = df_scores.sum(axis=1)
    else:
        divisor = df_scores.sum(axis=1).replace(0, 1)
        df_scores_normalized = df_scores.div(divisor, axis=0)

    df_scores_normalized = df_scores_normalized.reset_index(names=[measured_id])

    print("Done.")
    return df_scores_normalized


def search_person(query, scores_df):
    # Split query into words to allow matching names with middle names
    query_words = query.lower().split()

    if not query_words:
        print("Please provide a search query.")
        return []

    # Get names depending on if it's an index or column
    if "person_id" in scores_df.columns:
        names = scores_df["person_id"].dropna().tolist()
    else:
        names = scores_df.index.dropna().tolist()

    # Find all matches where ALL query words are present in the name
    matches = [name for name in names if all(word in name for word in query_words)]

    if not matches:
        print(f"No matches found for '{query}'.")
        # Try matching any of the words as a fallback
        fallback_matches = [
            name for name in names if any(word in name for word in query_words)
        ]
        if fallback_matches:
            print(f"Found partial matches {fallback_matches[:10]}")
        return []

    return matches
