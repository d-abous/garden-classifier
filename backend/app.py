import os
import re
import math
import replicate
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Every /classify call spends Replicate credits, so only the garden's own pages may call it.
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

# Only the garden's own temporary uploads may be classified, so the endpoint can't be used to
# run CLIP on arbitrary images (or to make the model fetch arbitrary URLs).
PENDING_IMAGE_URL = re.compile(
    r"^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/flower-images/pending/[0-9a-f-]+\.png$"
)

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


@app.route("/classify", methods=["POST"])
def classify():
    body = request.get_json(silent=True)

    if not body or "imageUrl" not in body:
        return jsonify({"error": "Missing imageUrl in request body"}), 400

    image_url: str = body["imageUrl"]

    if not isinstance(image_url, str) or not PENDING_IMAGE_URL.fullmatch(image_url):
        return jsonify({"error": "imageUrl must be a pending garden upload"}), 400

    token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not token or token == "r8_YourTokenHere":
        return jsonify({"error": "REPLICATE_API_TOKEN not configured"}), 500

    try:
        scores = classify_image(image_url)
    except Exception as exc:
        print("Replicate error:", exc)
        return jsonify({"error": "Classification failed"}), 500

    label = determine_label(scores)

    return jsonify({"label": label, "scores": scores})


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
