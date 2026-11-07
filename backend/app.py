import os
import math
import uuid
import base64
import binascii
import httpx
import replicate
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Every /plant call spends Replicate credits, so only the garden's own pages may call it.
# Local dev servers on any port are always allowed; deployed sites come from ALLOWED_ORIGINS
# (comma-separated, e.g. "https://garden-classifier.onrender.com").
LOCAL_ORIGINS = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
DEPLOYED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
CORS(app, origins=[LOCAL_ORIGINS, *DEPLOYED_ORIGINS])

# Several phrasings per category (prompt ensembling). A single prompt per category let
# CLIP call almost any doodle a flower; many concrete alternatives give scribbles,
# circles and smileys somewhere better to land. Tuned on the garden's real drawings.
PROMPTS = {
    "flower": [
        "a flower with petals drawn by hand",
        "a drawing of a flower",
        "a simple sketch of a flower with a stem",
        "a child's drawing of a flower",
        "a doodle of a tulip",
        "a doodle of a rose",
        "a doodle of a daisy",
        "a flower",
    ],
    "scribbles": [
        "scribbles and random lines with no clear subject",
        "a scribble",
        "random squiggly lines",
        "a zigzag line",
        "a messy doodle of lines",
        "a circle",
        "a smiley face",
        "a letter or handwriting",
        "an abstract doodle",
        "a spiral",
        "a squiggle",
    ],
    "inappropriate": [
        "explicit sexual content or nudity",
        "a drawing of genitals",
        "a drawing of a penis",
        "a crude sexual doodle",
        "a drawing of breasts",
        "a nude body",
    ],
}
ALL_PROMPTS = [(category, text) for category, texts in PROMPTS.items() for text in texts]

# CLIP's learned logit scale: softmax(100 * cosine) turns similarities into probabilities.
CLIP_LOGIT_SCALE = 100.0
# Real flowers scored >= 0.97 and non-flowers <= 0.67 on the garden's drawings.
FLOWER_MIN_PROB = 0.8
# A plain circle reached 0.6 "inappropriate", so require a clearer signal.
INAPPROPRIATE_MIN_PROB = 0.75

# Flowers are saved here, with the service-role key, only after CLIP accepts them. Visitors'
# browsers can only read the garden, so nothing can skip the classifier.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "flower-images"
MAX_IMAGE_BYTES = 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# The ranges app.js picks placement values from (a little slack for rounding).
FIELD_RANGES = {"x": (0, 100), "y": (0, 100), "size": (40, 200), "tilt": (-45, 45)}

REPLICATE_MODEL = "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a"


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def softmax(values: list[float]) -> list[float]:
    peak = max(values)
    exps = [math.exp(v - peak) for v in values]
    total = sum(exps)
    return [e / total for e in exps]


def classify_image(image_url: str) -> dict:
    # The model only embeds http(s) URLs as images; anything else is embedded as text.
    inputs_str = "\n".join([image_url] + [text for _, text in ALL_PROMPTS])

    output = replicate.run(
        REPLICATE_MODEL,
        input={"inputs": inputs_str},
    )

    image_embedding = output[0]["embedding"]
    similarities = [
        cosine_similarity(image_embedding, output[i + 1]["embedding"])
        for i in range(len(ALL_PROMPTS))
    ]
    probs = softmax([CLIP_LOGIT_SCALE * sim for sim in similarities])

    # Each category's probability is the sum over its prompts.
    scores = {category: 0.0 for category in PROMPTS}
    for (category, _), prob in zip(ALL_PROMPTS, probs):
        scores[category] += prob
    return scores


def determine_label(scores: dict) -> str:
    top_category = max(scores, key=scores.get)
    top_prob = scores[top_category]

    if top_category == "inappropriate" and top_prob >= INAPPROPRIATE_MIN_PROB:
        return "SECRET_GARDEN"
    if top_category == "flower" and top_prob >= FLOWER_MIN_PROB:
        return "ACCEPT"
    return "REJECT"


def supabase_headers(extra=None):
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    headers.update(extra or {})
    return headers


def upload_image(path: str, png: bytes) -> str:
    response = httpx.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        content=png,
        headers=supabase_headers({"Content-Type": "image/png"}),
        timeout=30,
    )
    response.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


def remove_image(path: str) -> None:
    try:
        httpx.request(
            "DELETE",
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}",
            json={"prefixes": [path]},
            headers=supabase_headers(),
            timeout=30,
        ).raise_for_status()
    except httpx.HTTPError as exc:
        print("Could not remove pending image:", exc)


def insert_flower(row: dict) -> dict:
    response = httpx.post(
        f"{SUPABASE_URL}/rest/v1/flowers",
        json=row,
        headers=supabase_headers({"Prefer": "return=representation"}),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()[0]


def decode_png(data_url) -> bytes | None:
    prefix = "data:image/png;base64,"
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        return None
    if len(data_url) > MAX_IMAGE_BYTES * 4 // 3 + len(prefix) + 4:
        return None
    try:
        png = base64.b64decode(data_url[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(png) > MAX_IMAGE_BYTES or not png.startswith(PNG_SIGNATURE):
        return None
    return png


def read_placement(body: dict) -> dict | None:
    placement = {}
    for field, (low, high) in FIELD_RANGES.items():
        value = body.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not math.isfinite(value) or not low <= value <= high:
            return None
        placement[field] = float(value)
    return placement


@app.route("/plant", methods=["POST"])
def plant():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON body"}), 400

    png = decode_png(body.get("image"))
    if png is None:
        return jsonify({"error": "image must be a PNG data URL under 1 MB"}), 400

    placement = read_placement(body)
    if placement is None:
        return jsonify({"error": "x, y, size and tilt must be numbers in range"}), 400

    token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not token or token == "r8_YourTokenHere":
        return jsonify({"error": "REPLICATE_API_TOKEN not configured"}), 500
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return jsonify({"error": "Supabase is not configured"}), 500

    flower_id = str(uuid.uuid4())
    pending_path = f"pending/{flower_id}.png"

    try:
        # CLIP reads images from a public URL, so it looks at a temporary copy that's removed after.
        pending_url = upload_image(pending_path, png)
        try:
            scores = classify_image(pending_url)
        finally:
            remove_image(pending_path)

        label = determine_label(scores)
        if label != "ACCEPT":
            return jsonify({"label": label, "scores": scores})

        image_url = upload_image(f"flowers/{flower_id}.png", png)
        flower = insert_flower({"id": flower_id, "image_url": image_url, **placement})
    except Exception as exc:
        print("Planting error:", exc)
        return jsonify({"error": "Could not plant that flower"}), 500

    return jsonify({"label": label, "scores": scores, "flower": flower})


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
