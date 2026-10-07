import itertools


def struct_pack(struct: dict[str, str]) -> str:
    return ", ".join(f"{k} := {v}" for k, v in struct.items())


def create_people_table(
    con,
    tbl_name,
    to_list: list[str] = [],
    any_vals: list[str] = [],
    flatten_list: list[str] = [],
    identity: str | None = None,
    **kwargs: dict[str, str],
):
    """
    Pass kwargs to struct_pack each argument according to the passed dict

    `identity` names a column of the raw table that says outright who a row is,
    as rejestr.io's person id does: rows sharing a value are one person, rows
    with two values are two people whatever they are called, and each person is
    one row, spelled one way. A row without a value is somebody's only when
    exactly one value has its name and its full `birth_date`, which the raw
    table then needs; otherwise it is grouped with the rows of the same name
    and date.
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
    merge_list = [
        f"""list_distinct(list_concat(
            coalesce(non_null.{col}, []), coalesce(nulls.{col}, []))) as {col}"""
        for col in itertools.chain(kwargs, to_list, flatten_list)
    ]
    any_vals_merge_list = [
        f"coalesce(non_null.{col}, nulls.{col}) as {col}" for col in any_vals
    ]

    all_merge_list = merge_list + any_vals_merge_list

    final_aggs_select = ""
    if all_merge_list:
        final_aggs_select = ",\n" + ",\n".join(all_merge_list)

    spelled = "raw_with_second_name"
    one_spelling_per_identity = ""
    partition_names = "PARTITION BY first_name, last_name, derived_second_name"
    effective_birth_year = f"""CASE
                    WHEN (MAX(birth_year) OVER ({partition_names}) -
                          MIN(birth_year) OVER ({partition_names})) <= 1 THEN
                        MAX(birth_year) OVER ({partition_names})
                    ELSE
                        birth_year
                END"""
    person_key = person_key_join = ""
    if identity is not None:
        spelled = "raw_spelled"
        # Each person's own year: the window above moves a year towards a
        # namesake's, and a person is one value or one name and date here.
        effective_birth_year = "birth_year"
        person_key = ", person_key"
        person_key_join = "AND non_null.person_key = nulls.person_key"
        one_spelling_per_identity = f"""
        adoptable AS (
            -- Who a row without an identity is: an odpis seat whose PESEL
            -- matched nobody rejestr.io lists at that company. The PESEL gives
            -- the date, so the one identity with the same name and date is the
            -- same person - unless a middle name says otherwise, or two
            -- identities fit, in which case it is neither.
            SELECT
                r.first_name,
                r.last_name,
                r.birth_date,
                r.derived_second_name,
                min(i.{identity}) as adopted
            FROM (
                SELECT DISTINCT first_name, last_name, birth_date, derived_second_name
                FROM raw_with_second_name
                WHERE {identity} IS NULL
            ) r
            JOIN (
                SELECT DISTINCT
                    {identity}, first_name, last_name, birth_date, derived_second_name
                FROM raw_with_second_name
                WHERE {identity} IS NOT NULL
            ) i
                ON i.first_name = r.first_name
                AND i.last_name = r.last_name
                AND i.birth_date = r.birth_date
                AND (coalesce(r.derived_second_name, '') = ''
                    OR coalesce(i.derived_second_name, '') = ''
                    OR i.derived_second_name = r.derived_second_name)
            GROUP BY ALL
            HAVING count(DISTINCT i.{identity}) = 1
        ),
        raw_identified AS (
            SELECT r.* REPLACE (coalesce(r.{identity}, a.adopted) as {identity})
            FROM raw_with_second_name r
            LEFT JOIN adoptable a
                ON r.{identity} IS NULL
                AND a.first_name = r.first_name
                AND a.last_name = r.last_name
                AND a.birth_date = r.birth_date
                AND a.derived_second_name IS NOT DISTINCT FROM r.derived_second_name
        ),
        spellings AS (
            -- Each way one person's name is written, and how well its middle
            -- name is attested: one the source wrote out, then the source
            -- saying there is none, then one guessed from the full name - a
            -- guess that makes "ewicz" the middle name of Grzegorz
            -- Grzegorzewicz.
            SELECT
                {identity},
                first_name,
                last_name,
                derived_second_name,
                min(CASE
                    WHEN second_name != '' THEN 0
                    WHEN second_name = '' THEN 1
                    WHEN derived_second_name != '' THEN 2
                    ELSE 3
                END) as attested,
                length(regexp_replace(
                    concat_ws(' ', first_name, derived_second_name, last_name),
                    '[^ąćęłńóśźż]', '', 'g')) as polish_letters,
                count(*) as written
            FROM raw_identified
            WHERE {identity} IS NOT NULL
            GROUP BY ALL
        ),
        spelling AS (
            -- The best attested; then the one with the most Polish letters,
            -- because an entry typed without them ("Golanski") is a copy of
            -- one typed with them and never the other way round; then the
            -- commonest; then the first alphabetically, so that the answer
            -- does not depend on the order the rows arrive in.
            SELECT * FROM spellings
            QUALIFY row_number() OVER (
                PARTITION BY {identity}
                ORDER BY attested, polish_letters DESC, written DESC,
                    last_name, first_name, derived_second_name
            ) = 1
        ),
        raw_spelled AS (
            SELECT
                r.* REPLACE (
                    coalesce(s.first_name, r.first_name) as first_name,
                    coalesce(s.last_name, r.last_name) as last_name,
                    CASE
                        WHEN s.{identity} IS NULL THEN r.derived_second_name
                        ELSE s.derived_second_name
                    END as derived_second_name
                ),
                -- Who the row is, for the grouping below: its identity, or
                -- failing one its date - the name is grouped on anyway.
                coalesce(
                    CAST(r.{identity} AS VARCHAR),
                    'born ' || CAST(r.birth_date AS VARCHAR)
                ) as person_key
            FROM raw_identified r
            LEFT JOIN spelling s ON r.{identity} = s.{identity}
        ),"""

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
        ),{one_spelling_per_identity}
        raw_filled_birth_year AS (
            SELECT
                *,
                {effective_birth_year} as effective_birth_year
            FROM {spelled}
        ),
        null_second_names AS (
            SELECT
                first_name,
                last_name,
                effective_birth_year as birth_year{person_key}
                {agg_select_str}
            FROM raw_filled_birth_year
            WHERE derived_second_name IS NULL OR derived_second_name = ''
            GROUP BY first_name, last_name, effective_birth_year{person_key}
        ),
        non_null_second_names AS (
            SELECT
                first_name,
                last_name,
                effective_birth_year as birth_year,
                derived_second_name{person_key}
                {agg_select_str}
            FROM raw_filled_birth_year
            WHERE derived_second_name IS NOT NULL AND derived_second_name != ''
            GROUP BY first_name, last_name, effective_birth_year,
                derived_second_name{person_key}
        )
        SELECT
            coalesce(non_null.first_name, nulls.first_name) as first_name,
            coalesce(non_null.last_name, nulls.last_name) as last_name,
            non_null.derived_second_name as second_name,
            coalesce(non_null.birth_year, nulls.birth_year) as birth_year
            {final_aggs_select}
        FROM non_null_second_names as non_null
        FULL OUTER JOIN null_second_names as nulls
        ON non_null.first_name = nulls.first_name
        AND non_null.last_name = nulls.last_name
        AND (non_null.birth_year = nulls.birth_year
            OR (non_null.birth_year IS NULL AND nulls.birth_year IS NULL))
        {person_key_join}
        """
    )
