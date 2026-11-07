# Hi there! Thanks for stopping by my garden 😄

https://github.com/user-attachments/assets/1dcd543c-7794-4ece-98c6-76b03f3fa733

Draw a flower and press Plant. If it really is a flower, it joins my community garden that everyone visiting
my site shares.

Access it [here](https://danas-garden.onrender.com).

## How it works

1. **You draw.** The page is plain HTML, CSS and JavaScript ([index.html](index.html), [app.js](app.js),
   [styles.css](styles.css)). Your drawing is shrunk to a small 180×180 PNG and sent to the backend.
2. **The backend checks it.** A small Flask app ([backend/app.py](backend/app.py)) uploads a temporary copy
   of the image and asks CLIP (an AI model, run on [Replicate](https://replicate.com)) what it looks like.
3. **Flowers get planted.** If CLIP is confident it's a flower, the image and a database row are saved
   in [Supabase](https://supabase.com). Anything else is thrown away.
4. **Everyone sees it.** The page shows the 25 newest flowers on the garden mound, and every flower in
   the gallery.

Visitors' browsers can only *read* the garden. Only the backend can save to it, so every flower there
has passed the check.

Each flower's spot is picked by trying lots of random places on the mound and keeping the one farthest
from the other flowers. The randomness is seeded by the flower's id, so everyone sees the same garden
and new flowers never push old ones around.

## How CLIP works

CLIP is a model from OpenAI that understands both pictures and text. It has two parts:

- an **image encoder** that turns a picture into a list of numbers (a vector), and
- a **text encoder** that turns a sentence into a vector of the same size.

It was trained on hundreds of millions of images with their captions from the internet. For each batch,
it learned to make every image's vector close to its own caption's vector and far from all the other
captions. After that, pictures and descriptions of the same thing end up pointing in nearly the same
direction.

That means CLIP can sort images into categories it was never trained on: you just describe the
categories in words, and pick the description closest to the image. This is called **zero-shot
classification**.

### How the garden uses it

The backend has 25 short descriptions in three groups:

- **flower:** "a drawing of a flower", "a doodle of a tulip", "a child's drawing of a flower", ...
- **scribbles:** "a scribble", "a circle", "a smiley face", "a spiral", ...
- **inappropriate:** descriptions of rude drawings.

For each drawing:

1. CLIP turns the drawing into a vector. (The 25 descriptions were turned into vectors once and are
   reused, which keeps it fast.)
2. The drawing is compared with each description using **cosine similarity**: how closely the two
   vectors point in the same direction.
3. Those similarities are turned into probabilities that add up to 1, and each group's probabilities
   are added together.
4. The drawing is planted only if **flower** wins with at least 80%. It's called inappropriate only if
   that group wins with at least 75%. Everything else is a scribble.

Having lots of non-flower descriptions matters. With only one description per group, CLIP called almost
any doodle a flower, because "flower" was the closest of very few options. Giving circles, smileys and
spirals their own descriptions gives them somewhere better to land.

## Try it yourself

You need a [Supabase](https://supabase.com) project and a [Replicate](https://replicate.com) API token.

1. In Supabase, run [supabase-setup.sql](supabase-setup.sql) in the SQL editor, then put your project URL
   and anon key in [config.js](config.js).
2. In `backend/`, copy `.env.example` to `.env` and fill in `REPLICATE_API_TOKEN`, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key out of `config.js`.
3. Start the backend:

   ```bash
   cd backend && pip install -r requirements.txt && python app.py
   ```

4. In another terminal, start the page from the project root and open `http://localhost:8000`:

   ```bash
   python serve.py
   ```

To deploy, [render.yaml](render.yaml) sets up both the page and the backend on
[Render](https://render.com) (**New > Blueprint**).
