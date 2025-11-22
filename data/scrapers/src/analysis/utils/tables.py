def struct_pack(struct: dict[str, str]) -> str:
    return ", ".join(f"{k} := {v}" for k, v in struct.items())


def init_tables(con):
    con.execute(
        """
        INSTALL splink_udfs FROM community;
        LOAD splink_udfs;
        """
    )


def create_people_table(
    con,
    tbl_name,
    to_list: list[str] = [],
    any_vals: list[str] = [],
    flatten_list: list[str] = [],
    **kwargs: dict[str, str],
):

    init_tables(con)

    """
    Pass kwargs to struct_pack each argument according to the passed dict
    """

    kwargs_select_list = [
        f"list(struct_pack({struct_pack(struct)})) as {col}"
        for col, struct in kwargs.items()
    ]
    to_list_select_list = [f"list_distinct(list({col})) as {col}" for col in to_list]
    flatten_list_select_list = [
        f"list_distinct(flatten(list({col}))) as {col}" for col in flatten_list
    ]
    any_vals_select_list = [f"any_value({col}) as {col}" for col in any_vals]

    all_aggs_select_list = (
        kwargs_select_list
        + to_list_select_list
        + flatten_list_select_list
        + any_vals_select_list
    )

    agg_select_str = ""
    if all_aggs_select_list:
        agg_select_str = ",\n" + ",\n".join(all_aggs_select_list)

    # For the final SELECT statement, prepare merge logic
    kwargs_merge_list = [
        f"list_distinct(list_concat(coalesce(non_null.{col}, []), coalesce(nulls.{col}, []))) as {col}"
        for col in kwargs
    ]
    to_list_merge_list = [
        f"list_distinct(list_concat(coalesce(non_null.{col}, []), coalesce(nulls.{col}, []))) as {col}"
        for col in to_list
    ]
    flatten_list_merge_list = [
        f"list_distinct(list_concat(coalesce(non_null.{col}, []), coalesce(nulls.{col}, []))) as {col}"
        for col in flatten_list
    ]
    any_vals_merge_list = [
        f"coalesce(non_null.{col}, nulls.{col}) as {col}" for col in any_vals
    ]

    all_merge_list = (
        kwargs_merge_list
        + to_list_merge_list
        + flatten_list_merge_list
        + any_vals_merge_list
    )

    final_aggs_select = ""
    if all_merge_list:
        final_aggs_select = ",\n" + ",\n".join(all_merge_list)

    con.execute(
        f"""
        CREATE OR REPLACE TABLE {tbl_name} AS
        WITH raw_with_second_name AS (
            SELECT
                *,
                coalesce(
                    second_name,
                    trim(replace(
                        replace(lower(full_name), lower(first_name), ''),
                        lower(last_name),
                        ''))
                ) as derived_second_name
            FROM {tbl_name}_raw
        ),
        null_second_names AS (
            SELECT
                first_name,
                last_name,
                birth_year
                {agg_select_str}
            FROM raw_with_second_name
            WHERE derived_second_name IS NULL OR derived_second_name = ''
            GROUP BY first_name, last_name, birth_year
        ),
        non_null_second_names AS (
            SELECT
                first_name,
                last_name,
                birth_year,
                derived_second_name
                {agg_select_str}
            FROM raw_with_second_name
            WHERE derived_second_name IS NOT NULL AND derived_second_name != ''
            GROUP BY first_name, last_name, birth_year, derived_second_name
        )
        SELECT
            coalesce(non_null.first_name, nulls.first_name) as first_name,
            coalesce(non_null.last_name, nulls.last_name) as last_name,
            non_null.derived_second_name as second_name,
            double_metaphone(coalesce(non_null.last_name, nulls.last_name)) as metaphone,
            coalesce(non_null.birth_year, nulls.birth_year) as birth_year
            {final_aggs_select}
        FROM non_null_second_names as non_null
        FULL OUTER JOIN null_second_names as nulls
        ON non_null.first_name = nulls.first_name
        AND non_null.last_name = nulls.last_name
        AND non_null.birth_year = nulls.birth_year
        """
    )
