import pandas as pd
from google import genai
from joblib import Memory
from tqdm import tqdm
import os

prompt = "Given a wikipedia article please list all people mentioned in this article in a list and output as in python. Example output: [Ala Biba, Barack Obama]\n\n"
memory = Memory(location="/tmp/genai_cache", verbose=0)
client = genai.Client(api_key=os.environ["GENAI_API_KEY"])


def iou(a: list[str], b: list[str]) -> float:
    a = set(x.lower() for x in a)
    b = set(x.lower() for x in b)
    return len(a & b) / len(a | b)


def parse_response(response: str) -> list[str]:
    l = response.index("[")
    r = response.index("]")
    return [name.strip()[1:-1] for name in response[l + 1: r].split(",")]


@memory.cache
def get_response(prompt: str) -> str:
    pred = client.models.generate_content(model="gemini-3-flash-preview", contents=prompt)
    return pred


def percent_words_in_text(names: list[str], text: str) -> float:
    matched_words = 0
    text_lower = text.lower()
    for name in names:
        matched_words += name.lower() in text_lower
    return matched_words / len(names)


def words_not_in_text(names: list[str], text: str) -> list[str]:
    words = []
    for name in names:
        if name.lower() not in text.lower():
            words.append(name)
    return words


def main():
    df = pd.read_json("versioned/person_wikipedia_ner/person_wikipedia_ner.jsonl", lines=True)
    df["n_names"] = df["names"].apply(len)
    ex_df = df[df["n_names"].le(100) & df["n_names"].ge(10)].sample(10, random_state=42)
    print(ex_df)

    preds = []
    for i, row in tqdm(ex_df.iterrows(), total=len(ex_df), desc="Processing examples"):
        pred = get_response(prompt + row["text"])

        try:
            pred_names = parse_response(pred.text)
        except Exception as e:
            pred_names = None

        preds.append(sorted(pred_names))

    ex_df["pred_names"] = preds
    ex_df["percent_names_in_text"] = ex_df.apply(lambda r: percent_words_in_text(r["names"], r["text"]), axis=1)
    ex_df["percent_pred_names_in_text"] = ex_df.apply(lambda r: percent_words_in_text(r["pred_names"], r["text"]),
                                                      axis=1)
    ex_df["iou"] = ex_df.apply(lambda r: iou(r["names"], r["pred_names"]), axis=1)
    ex_df["names_not_in_text"] = ex_df.apply(lambda r: words_not_in_text(r["names"], r["text"]), axis=1)
    ex_df["pred_names_not_in_text"] = ex_df.apply(lambda r: words_not_in_text(r["pred_names"], r["text"]), axis=1)

    import IPython
    IPython.embed()


if __name__ == "__main__":
    main()
