import networkx as nx
import pandas as pd

from analysis.people_pkw_merged import PeoplePKWMerged
from analysis.utils import committee_to_party
from scrapers.stores import Context


def flatten_parties(df):
    df["person_id"] = df["first_name"] + " " + df["second_name"] + " " + df["last_name"]

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


def calculate_people_parties(ctx: Context):
    df = PeoplePKWMerged().read_or_process(ctx)
    df = flatten_parties(df)

    print(df[:10])

    committes_to_parties = pd.DataFrame.from_records(
        [(committee, party) for committee, party in committee_to_party.items()],
        columns=["subgroup_id", "group_id"],
    )
    print(committes_to_parties[:10])

    return calculate_ppr_scores(df, committes_to_parties)


def calculate_ppr_scores(
    df_people_subgroups: pd.DataFrame,
    df_subgroups_groups: pd.DataFrame,
    alpha: float = 0.85,
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
    person_nodes = [p_node(pid) for pid in df_people_subgroups["person_id"].unique()]
    group_nodes = [g_node(gid) for gid in df_subgroups_groups["group_id"].unique()]

    print(f"Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges.")
    print(f"Found {len(person_nodes)} people and {len(group_nodes)} groups.")

    # 3. Run Personalized PageRank for each group
    all_scores = {}

    for i, group_node in enumerate(group_nodes):
        print(f"Calculating PPR for group {i + 1}/{len(group_nodes)} ({group_node})...")

        # Create the personalization vector
        # This vector tells PageRank to "teleport" back to our target group
        personalization = {node: 0 for node in G.nodes()}
        personalization[group_node] = 1

        # Run PageRank
        ppr_scores = nx.pagerank(G, alpha=alpha, personalization=personalization)

        # 4. Extract scores for *person* nodes only
        group_results = {}
        for p_id in person_nodes:
            # .get(p_id, 0) ensures a score of 0 if a person is
            # in a completely disconnected part of the graph
            group_results[p_id] = ppr_scores.get(p_id, 0)

        all_scores[group_node] = group_results

    # 5. Convert to DataFrame and Normalize
    print("Normalizing scores...")

    # Create the (Person x Group) score matrix
    df_scores = pd.DataFrame(all_scores)

    # Zero out small scores (noise from PageRank on disconnected components)
    df_scores[df_scores < 1e-5] = 0

    # Clean up the index and column names (remove 'p_' and 'g_')
    df_scores.index = df_scores.index.map(lambda x: x[2:])
    df_scores.columns = df_scores.columns.map(lambda x: x[2:])
    df_scores.index.name = "person_id"
    df_scores.columns.name = "group_id"

    # Normalize each *row* (person) to sum to 1 and avoid division by 0
    row_sums = df_scores.sum(axis=1)
    row_sums[row_sums == 0] = 1

    df_scores_normalized = df_scores.div(row_sums, axis=0)

    print("Done.")
    return df_scores_normalized
