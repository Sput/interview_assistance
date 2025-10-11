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
    return []

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
        query_url = f"{url}/rest/v1/answers_table"
        params = {
            "select": "id,embedding,answer_text,questions_table(id,embedding)",
            "answer_text": "not.is.null",
            "grade": "is.null"
        }
        
        response = requests.get(query_url, headers=headers, params=params)
        response.raise_for_status()
        
        data = response.json()
        if not data:
            print("No data found")
            return

        # 2. Loop over rows
        for row in data:
            answer_vec = parse_vector(row["embedding"])
            question_vec = parse_vector(row["questions_table"]["embedding"])

            if not answer_vec or not question_vec:
                print(f"Invalid embedding format for answer_id={row['id']}")
                continue

            similarity = cosine_similarity(answer_vec, question_vec)
            if not math.isfinite(similarity):
                print(f"Similarity invalid (NaN/Inf) for answer_id={row['id']}")
                continue

            grade = round(similarity * 100)

            # 3. Update grade back into answers_table using REST API
            update_url = f"{url}/rest/v1/answers_table"
            update_data = {"grade": grade}
            update_params = {"id": f"eq.{row['id']}"}
            
            update_resp = requests.patch(update_url, headers=headers, params=update_params, json=update_data)
            update_resp.raise_for_status()

            print(f"grade updated for answer_id={row['id']} → {grade}")

    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
    except Exception as e:
        print("Unexpected error:", e)

if __name__ == "__main__":
    update_grades()