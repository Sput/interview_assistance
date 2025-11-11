import os
import json
import math
import requests
from dotenv import load_dotenv

# Load environment variables from .env.local file
# Try multiple possible locations for the .env.local file
env_paths = [
    '.env.local',  # Current directory
    '../.env.local',  # Parent directory
    '../../.env.local',  # Two levels up
    '../../../.env.local',  # Three levels up
    '../../../../.env.local',  # So many levels up!
]

env_loaded = False
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"Loaded environment variables from: {env_path}")
        env_loaded = True
        break

if not env_loaded:
    print("Could not find .env.local file in any of the expected locations:")
    for path in env_paths:
        print(f"  - {path}")
    print("Please ensure .env.local file exists with the required variables")

# Supabase configuration
url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
print(f"Using Supabase URL: {url}")

if not url or not key:
    print(f"Missing environment variables:")
    print(f"NEXT_PUBLIC_SUPABASE_URL: {'✓' if url else '✗'}")
    print(f"NEXT_PUBLIC_SUPABASE_ANON_KEY: {'✓' if key else '✗'}")
    print("Please ensure .env.local file exists with these variables")
    exit(1)

# Use direct REST API instead of Supabase client
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

def parse_vector(v):
    """
    Convert pgvector text or list into Python list[float].
    Examples:
      "(0.1,0.2,0.3)"  -> [0.1, 0.2, 0.3]
      "[-0.1,0.2]"     -> [-0.1, 0.2]
    """
    if isinstance(v, str):
        try:
            # Try JSON first: "[-0.1,0.2]"
            return json.loads(v)
        except json.JSONDecodeError:
            # Fall back to pgvector text "(0.1,0.2,0.3)"
            v = v.strip("()")
            return [float(x) for x in v.split(",") if x]
    if isinstance(v, list):
        return [float(x) for x in v]
    if isinstance(v, dict):
        # Handle possible wrappers like { "data": [..] } or { "vector": [..] }
        for k in ("data", "vector", "embedding", "value"):
            if k in v:
                return parse_vector(v[k])
    return []


def resolve_embedding(row: dict, *keys: str):
    """Return (vector, key_used) where vector is the first non-empty parsed embedding for given keys."""
    for k in keys:
        if k in row and row[k] is not None:
            vec = parse_vector(row[k])
            if vec:
                return vec, k
    return [], None


def vec_head(vec, n=2):
    try:
        head = [float(vec[i]) for i in range(min(n, len(vec)))]
    except Exception:
        head = []
    return f"[{', '.join(f'{x:.4f}' for x in head)}]"

def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors."""
    dot = sum(ai * bi for ai, bi in zip(a, b))
    norm_a = math.sqrt(sum(ai * ai for ai in a))
    norm_b = math.sqrt(sum(bi * bi for bi in b))
    if norm_a == 0 or norm_b == 0:
        return float("nan")
    result = dot / (norm_a * norm_b)
    print(f"cosineSimilarity run for a row → {result}")
    return result

def update_grades():
    try:
        # 1. Fetch answers with related question embeddings using REST API
        # Only get rows where answer_text is not null and grade is null
        # Select only the row with the highest id
        query_url = f"{url}/rest/v1/answers_table"
        # Keep selection minimal to avoid 400s from unknown columns
        # Assumes `embedding` exists on both answers_table and questions_table.
        params = {
            "select": "id,question_id,answer_text,embedding,questions_table(id,embedding)",
            "answer_text": "not.is.null",
            "grade": "is.null",
            "order": "id.desc",
            "limit": "1"
        }
        
        print("Fetching answers needing grades ...")
        print(f"GET {query_url}")
        print(f"params: {params}")
        response = requests.get(query_url, headers=headers, params=params)
        response.raise_for_status()
        
        data = response.json()
        if not data:
            print("No data found")
            return
        print(f"Fetched {len(data)} answer candidate(s)")

        # 2. Loop over rows
        for row in data:
            rid = row.get("id")
            qid = row.get("question_id")
            atxt = row.get("answer_text") or ""
            print(f"\nProcessing answer_id={rid} question_id={qid} answer_len={len(atxt)}")

            # 2a. Resolve answer embedding from likely keys
            answer_vec, answer_key = resolve_embedding(
                row,
                "embedding",
                "answer_embedding",
                "vector",
                "answer_vector",
            )
            if answer_vec:
                print(f"Answer embedding from '{answer_key}' dims={len(answer_vec)} head={vec_head(answer_vec)}")
            else:
                print("Answer embedding not found in row")

            # 2b. Resolve question embedding from nested relation first
            qrel = row.get("questions_table") or {}
            question_vec, question_key = resolve_embedding(
                qrel,
                "embedding",
                "question_embedding",
                "vector",
                "question_vector",
            )
            if question_vec:
                print(f"Question embedding from join key='{question_key}' dims={len(question_vec)} head={vec_head(question_vec)}")
            else:
                print("Question embedding missing in join; attempting direct fetch …")

            # 2c. If still missing question_vec, try fetching directly by question_id
            if (not question_vec) and row.get("question_id"):
                try:
                    q_url = f"{url}/rest/v1/questions_table"
                    q_params = {
                        "select": "id,embedding",
                        "id": f"eq.{row['question_id']}"
                    }
                    print(f"GET {q_url} params={q_params}")
                    q_resp = requests.get(q_url, headers=headers, params=q_params)
                    q_resp.raise_for_status()
                    q_data = q_resp.json()
                    print(f"Fetched {len(q_data) if isinstance(q_data, list) else 'non-list'} question row(s)")
                    if isinstance(q_data, list) and q_data:
                        question_vec, question_key = resolve_embedding(q_data[0], "embedding")
                        if question_vec:
                            print(f"Question embedding from direct fetch dims={len(question_vec)} head={vec_head(question_vec)}")
                except Exception as qe:
                    print(f"Failed to fetch question embedding for question_id={row.get('question_id')}: {qe}")

            if not answer_vec:
                print(f"Invalid or missing answer embedding for answer_id={row['id']}")
                continue
            if not question_vec:
                print(f"Invalid or missing question embedding for answer_id={row['id']} (question_id={row.get('question_id')})")
                continue

            print("Computing cosine similarity …")
            print(f"answer dims={len(answer_vec)} head={vec_head(answer_vec)}")
            print(f"question dims={len(question_vec)} head={vec_head(question_vec)}")
            similarity = cosine_similarity(answer_vec, question_vec)
            if not math.isfinite(similarity):
                print(f"Similarity invalid (NaN/Inf) for answer_id={row['id']}")
                continue

            grade = round(similarity * 100)
            print(f"Computed grade={grade} for answer_id={row['id']}")

            # 3. Update grade back into answers_table using REST API
            update_url = f"{url}/rest/v1/answers_table"
            update_data = {"grade": grade}
            update_params = {"id": f"eq.{row['id']}"}
            print(f"PATCH {update_url} params={update_params} body={update_data}")
            update_resp = requests.patch(update_url, headers=headers, params=update_params, json=update_data)
            update_resp.raise_for_status()

            print(f"grade updated for answer_id={row['id']} → {grade}")

    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
    except Exception as e:
        print("Unexpected error:", e)

if __name__ == "__main__":
    update_grades()
