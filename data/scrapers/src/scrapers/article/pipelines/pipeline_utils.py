import pandas as pd

from entities.util import NormalizedParse
from scrapers.stores import Context, DoneUrl


def domains_from_done_urls(done_df: pd.DataFrame) -> set[str]:
    domains: set[str] = set()
    for row in done_df.itertuples(index=False):
        try:
            domains.add(NormalizedParse.parse(str(row.url)).hostname_normalized)
        except Exception:
            continue
    return domains


def iter_done_urls(done_df: pd.DataFrame) -> list[DoneUrl]:
    done_urls: list[DoneUrl] = []
    for row in done_df.to_dict(orient="records"):
        done_urls.append(
            DoneUrl(
                uid=str(row["uid"]),
                url=str(row["url"]),
                storage_path=str(row["storage_path"]),
                media_type=(
                    None
                    if pd.isna(row.get("media_type"))
                    else str(row.get("media_type"))
                ),
            )
        )
    return done_urls


def llm_model(ctx: Context) -> str:
    llm_config = getattr(ctx.llm, "config", None)
    model = getattr(llm_config, "model", None)
    if isinstance(model, str) and model.strip():
        return model
    return "Qwen/Qwen3-14B"
