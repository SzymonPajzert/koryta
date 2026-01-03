import argparse

import pandas as pd
from memoized_property import memoized_property  # type: ignore

from scrapers.koryta.download import FirestoreCollection
from scrapers.stores import Context, Pipeline

SCHEMAS = {
    "nodes": {
        "person": ["name", "parties", "content", "wikipedia", "rejestrIo"],
        "place": ["name", "krsNumber"],
        "article": ["name", "sourceURL", "shortName"],
    },
    "edges": {
        type_name: ["name", "content", "source", "target", "start_date", "end_date"]
        for type_name in ["employed", "connection", "mentions", "owns", "comment"]
    },
}


class KorytaDiffer(Pipeline):
    """
    Pipeline to compare koryta.pl exports.
    """

    filename = None  # No persistent output file for now, just stdout report

    @memoized_property
    def flags(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--diff-week",
            action="store_true",
            help="Show diff summary for the last week",
        )
        parser.add_argument(
            "--diff-date",
            type=str,
            help="Compare latest export vs this date (YYYY-MM-DD)",
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        self.id_map: dict[str, str] = {}
        for collection, types in SCHEMAS.items():
            for type_name, fields in types.items():
                self.process_type(ctx, collection, type_name, fields)

        return pd.DataFrame()

    def process_type(
        self, ctx: Context, collection: str, type_name: str, fields: list[str]
    ):
        print(f"\n=== Processing {collection}/{type_name} ===")

        try:
            pipe = FirestoreCollection(collection, type_name)
            df = pipe.read_or_process(ctx)
        except Exception as e:
            print(f"  Error processing {collection}/{type_name}: {e}")
            return

        if df.empty:
            print("  No data found.")
            return

        if "date" not in df.columns:
            print("  Warning: 'date' column missing in output")
            return

        # Handle dates: force string type to avoid Timestamp vs str comparison issues
        df["date"] = df["date"].astype(str)
        # Filter out invalid/empty dates if any
        dates = sorted(
            [
                d
                for d in df["date"].unique()
                if d and d.lower() not in ("nan", "none", "unknown", "nat")
            ]
        )

        # Populate id_map for nodes
        if collection == "nodes" and "name" in df.columns and "id" in df.columns:
            # Sort by date to get latest name
            df_sorted = df.sort_values("date")
            df_valid = df_sorted[df_sorted["name"].notna()]
            # Update map
            self.id_map.update(
                pd.Series(
                    df_valid["name"].values, index=df_valid["id"].astype(str)
                ).to_dict()
            )

        if not dates:
            print("  No export dates found.")
            return

        print(f"  Found {len(dates)} exports. Latest: {dates[-1]}")

        if self.flags and self.flags.diff_week:
            self.diff_week(df, dates, fields)
        elif self.flags and self.flags.diff_date:
            self.diff_date(df, dates, self.flags.diff_date, fields)
        elif len(dates) < 2:
            print("  Need at least 2 exports to compare.")
            self.print_stats(df, dates[-1], fields)
        else:
            self.compare_dates(df, dates[-2], dates[-1], fields, detailed=True)

    def diff_week(self, df: pd.DataFrame, dates: list[str], fields: list[str]):
        """Prints a summary of diffs for the last week."""
        recent_dates = dates[-15:]  # 7 * 2 intervals
        if len(recent_dates) < 2:
            print("  Not enough data for weekly diff.")
            return

        print(f"\n  Weekly Diff Summary ({recent_dates[0]} to {recent_dates[-1]}):")
        print(f"  {'Date':<32} | {'Total':<8} | {'New':<6} | {'Del':<6}")
        print("  " + "-" * 58)

        # TODO if there's no interesint diff, print just a single line
        for i in range(1, len(recent_dates)):
            self.compare_dates(
                df,
                recent_dates[i - 1],
                recent_dates[i],
                fields,
                summary_only=True,
            )

        # Show details for the last diff in the week if there are changes
        latest_date = recent_dates[-1]
        prev_date = recent_dates[-2]
        print("\n  Latest changes details:")
        self.compare_dates(
            df,
            prev_date,
            latest_date,
            fields,
            detailed=True,
            summary_only=False,
        )

    def diff_date(
        self, df: pd.DataFrame, dates: list[str], target: str, fields: list[str]
    ):
        if target not in dates:
            print(f"  Target date {target} not found in {dates}")
            return
        latest = dates[-1]
        self.compare_dates(df, target, latest, fields, detailed=True)

    def compare_dates(
        self,
        df: pd.DataFrame,
        date_a: str,
        date_b: str,
        fields: list[str],
        detailed: bool = False,
        summary_only: bool = False,
    ):
        df_a = df[df["date"] == date_a]
        df_b = df[df["date"] == date_b]

        ids_a = set(df_a["id"].astype(str))
        ids_b = set(df_b["id"].astype(str))

        new = ids_b - ids_a
        deleted = ids_a - ids_b

        if summary_only:
            print(
                f"  {date_b:<12} | {len(ids_b):<8} | {len(new):<6} | {len(deleted):<6}"
            )
            return

        print(f"\n  Comparing {date_a} -> {date_b}")
        print(f"  Total: {len(ids_a)} -> {len(ids_b)}")
        print(f"  New: {len(new)}, Deleted: {len(deleted)}")

        if detailed:
            self.print_stats(df, date_b, fields)

        if detailed and new:
            print(f"\n  New Entries ({len(new)}):")
            # Get full rows for new IDs
            new_rows = df_b[df_b["id"].astype(str).isin(new)]

            for _, row in new_rows.head(20).iterrows():
                # Build a string of important fields
                info = [f"ID: {row['id']}"]
                if "name" in row and pd.notna(row["name"]) and str(row["name"]).strip():
                    info.append(f"Name: {row['name']}")

                # Resolve source/target names
                if "source" in row and pd.notna(row["source"]):
                    s_id = str(row["source"])
                    s_name = self.id_map.get(s_id, s_id)
                    info.append(f"Source: {s_name}")

                if "target" in row and pd.notna(row["target"]):
                    t_id = str(row["target"])
                    t_name = self.id_map.get(t_id, t_id)
                    info.append(f"Target: {t_name}")

                # Check for other interesting fields
                extras = []
                for f in fields:
                    if f in ["name", "source", "target"]:
                        continue
                    if f in row and pd.notna(row[f]) and str(row[f]) != "":
                        val = str(row[f])
                        if len(val) > 40:
                            val = val[:37] + "..."
                        extras.append(f"{f}={val}")

                if extras:
                    info.append(f"[{', '.join(extras)}]")

                print(f"    + {' | '.join(info)}")

            if len(new) > 20:
                print(f"    ... and {len(new) - 20} more")

    def print_stats(self, df: pd.DataFrame, date: str, fields: list[str]):
        print(f"\n  Field Occurrence ({date}):")
        df_date = df[df["date"] == date]
        total = len(df_date)

        if total == 0:
            print("  No data.")
            return

        expected_fields = set(fields)
        expected_fields.update({"id", "date", "type", "revision_id", "_key"})

        # Report on expected fields
        for f in fields:
            if f in df_date.columns:
                count = df_date[f].notnull().sum()
                pct = (count / total) * 100
                print(f"    {f:<12}: {count:5d} ({pct:5.1f}%)")
            else:
                print(f"    {f:<12}:     0 (  0.0%) [Column missing]")

        # Report unexpected fields
        unexpected = [
            c
            for c in df_date.columns
            if c not in expected_fields and not c.startswith("_")
        ]
        if unexpected:
            print("\n  Unexpected Fields:")
            for f in unexpected:
                count = df_date[f].notnull().sum()
                pct = (count / total) * 100
                print(f"    {f:<12}: {count:5d} ({pct:5.1f}%)")
