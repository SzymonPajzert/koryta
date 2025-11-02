def struct_pack(struct: dict[str, str]) -> str:
    return ", ".join(f"{k} := {v}" for k, v in struct.items())


def init_tables(con):
    pass
    # we actually don't need it
    # con.execute(
    #     """
    #     INSTALL splink_udfs FROM community;
    #     LOAD splink_udfs;
    #     """
    # )


def create_people_table(
    con,
    tbl_name,
    to_list: list[str] = [],
    any_vals: list[str] = [],
    flatten_list: list[str] = [],
    **kwargs: dict[str, str],
):
    """
    Pass kwargs to struct_pack each argument according to the passed dict
    """
    con.execute(
        f"""
        CREATE OR REPLACE TABLE {tbl_name} AS
        SELECT
            first_name,
            last_name,
            coalesce(
                second_name,
                trim(replace(
                    replace(lower(full_name), lower(first_name), ''),
                    lower(last_name),
                    ''))) as second_name,
            birth_year,
            {'\n'.join([f"list(struct_pack({struct_pack(struct)})) as {col}," for col, struct in kwargs.items()])}
            {'\n'.join([f"list_distinct(list({col})) as {col}," for col in to_list])}
            {'\n'.join([f"list_distinct(flatten(list({col}))) as {col}," for col in flatten_list])}
            {'\n'.join([f"any_value({col}) as {col}," for col in any_vals])}
        FROM {tbl_name}_raw
        GROUP BY ALL
        """
    )
