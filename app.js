const MAX_VISIBLE_GARDEN_FLOWERS = 25;
const RECENT_GARDEN_FLOWER_LIMIT = 25;
const SUPABASE_FLOWERS_BUCKET = "flower-images";
const SUPABASE_CONFIG = window.GARDEN_SUPABASE_CONFIG ?? {
  url: "YOUR_SUPABASE_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};

const galleryModal = document.querySelector("#gallery-modal");
const openGalleryButtons = document.querySelectorAll("[data-open-gallery]");
const closeGalleryButton = document.querySelector("[data-close-gallery]");
const drawingCanvas = document.querySelector(".drawing-canvas");
const canvasContext = drawingCanvas?.getContext("2d");
const swatches = document.querySelectorAll(".swatch[data-color]");
const resetCanvasButton = document.querySelector("[data-reset-canvas]");
const canvasStatus = document.querySelector(".canvas-status");
const panelTitle = document.querySelector("#draw-panel-title");
const DEFAULT_PANEL_TITLE = panelTitle?.textContent ?? "";
const PANEL_MESSAGE_MS = 5000;
const TYPE_DELAY_MS = 45;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const plantFlowerButton = document.querySelector("[data-plant-flower]");
const plantedFlowersLayer = document.querySelector("[data-planted-flowers]");
const galleryGrid = document.querySelector("[data-gallery-grid]");
const galleryStats = document.querySelector("[data-gallery-stats]");
const classifier = window.GardenClassifier;
const supabaseClient = createSupabaseClient();

let activeBrushColor = "#f27f6a";
let isDrawing = false;
let isPlanting = false;
let allFlowers = [];
let visibleGardenFlowers = [];

for (const button of openGalleryButtons) {
  button.addEventListener("click", () => {
    galleryModal?.showModal();
  });
}

closeGalleryButton?.addEventListener("click", () => {
  galleryModal?.close();
});

galleryModal?.addEventListener("click", (event) => {
  const bounds = galleryModal.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) {
    galleryModal.close();
  }
});

function createSupabaseClient() {
  const trimmedUrl = SUPABASE_CONFIG.url?.trim();
  const trimmedAnonKey = SUPABASE_CONFIG.anonKey?.trim();
  const usesPlaceholderValues =
    !trimmedUrl ||
    !trimmedAnonKey ||
    trimmedUrl.includes("YOUR_SUPABASE_URL") ||
    trimmedAnonKey.includes("YOUR_SUPABASE_ANON_KEY") ||
    trimmedUrl.includes("yourproject.supabase.co") ||
    trimmedAnonKey === "your-supabase-key";
  const hasValidConfig =
    !usesPlaceholderValues;

  if (!hasValidConfig || !window.supabase?.createClient) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const looksLikeSupabaseProject =
      parsedUrl.protocol === "https:" && parsedUrl.hostname.endsWith(".supabase.co");

    if (!looksLikeSupabaseProject) {
      console.error("Supabase config error: invalid project URL", trimmedUrl);
      return null;
    }

    return window.supabase.createClient(trimmedUrl, trimmedAnonKey);
  } catch (error) {
    console.error("Supabase config error: malformed URL", trimmedUrl, error);
    return null;
  }
}

let panelTitleTimers = [];

// Types text into the panel title one letter at a time. The whole line is laid out
// up front with hidden letters, so the centered title doesn't shift while it types.
function typePanelTitle(text, onDone) {
  for (const timer of panelTitleTimers) {
    clearTimeout(timer);
  }
  panelTitleTimers = [];

  if (prefersReducedMotion.matches) {
    panelTitle.textContent = text;
    onDone?.();
    return;
  }

  const letters = [...text].map((char) => {
    const letter = document.createElement("span");
    letter.className = "typed-letter";
    letter.textContent = char;
    return letter;
  });
  panelTitle.replaceChildren(...letters);

  letters.forEach((letter, index) => {
    panelTitleTimers.push(
      setTimeout(() => {
        letter.classList.add("is-typed");
        if (index === letters.length - 1) {
          onDone?.();
        }
      }, index * TYPE_DELAY_MS)
    );
  });
}

// Shows a floating message in place of the panel title, then types the title back.
function showPanelMessage(message) {
  if (!panelTitle) {
    return;
  }

  panelTitle.classList.add("is-message");
  typePanelTitle(message, () => {
    panelTitleTimers.push(
      setTimeout(() => {
        panelTitle.classList.remove("is-message");
        typePanelTitle(DEFAULT_PANEL_TITLE);
      }, PANEL_MESSAGE_MS)
    );
  });
}

function resizeCanvas() {
  if (!drawingCanvas || !canvasContext) {
    return;
  }

  const { width, height } = drawingCanvas.getBoundingClientRect();
  const deviceScale = window.devicePixelRatio || 1;
  const nextWidth = Math.round(width * deviceScale);
  const nextHeight = Math.round(height * deviceScale);

  // Phones fire resize whenever the address bar shows or hides (e.g. scrolling down to Plant).
  // Setting canvas.width wipes the drawing, so only resize when the size really changed,
  // and carry the drawing over when it did (e.g. rotating the phone).
  if (drawingCanvas.width === nextWidth && drawingCanvas.height === nextHeight) {
    return;
  }

  const previousDrawing = document.createElement("canvas");
  previousDrawing.width = drawingCanvas.width;
  previousDrawing.height = drawingCanvas.height;
  previousDrawing.getContext("2d")?.drawImage(drawingCanvas, 0, 0);

  drawingCanvas.width = nextWidth;
  drawingCanvas.height = nextHeight;
  canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  if (previousDrawing.width && previousDrawing.height) {
    canvasContext.drawImage(previousDrawing, 0, 0, nextWidth, nextHeight);
  }
  canvasContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  canvasContext.lineCap = "round";
  canvasContext.lineJoin = "round";
  canvasContext.lineWidth = 8;
  canvasContext.strokeStyle = activeBrushColor;
}

function setBrushColor(color, label) {
  activeBrushColor = color;

  if (canvasContext) {
    canvasContext.strokeStyle = color;
  }

  if (canvasStatus) {
    canvasStatus.textContent = `Brush: ${label}`;
  }
}

function hasCanvasDrawing() {
  if (!drawingCanvas || !canvasContext) {
    return false;
  }

  const pixels = canvasContext.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;

  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      return true;
    }
  }

  return false;
}

function createFlowerImage() {
  if (!drawingCanvas) {
    return "";
  }

  const previewCanvas = document.createElement("canvas");
  const previewContext = previewCanvas.getContext("2d");

  if (!previewContext) {
    return "";
  }

  previewCanvas.width = 180;
  previewCanvas.height = 180;

  // Fit the drawing into the square without stretching it, whatever shape the canvas is.
  const scale = Math.min(180 / drawingCanvas.width, 180 / drawingCanvas.height);
  const drawWidth = drawingCanvas.width * scale;
  const drawHeight = drawingCanvas.height * scale;
  previewContext.drawImage(
    drawingCanvas,
    (180 - drawWidth) / 2,
    (180 - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  return previewCanvas.toDataURL("image/png");
}

function dataUrlToBlob(dataUrl) {
  const [header, payload] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);

  if (!payload || !mimeMatch) {
    return null;
  }

  const mimeType = mimeMatch[1];
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function clearCanvas() {
  if (!drawingCanvas || !canvasContext) {
    return;
  }

  canvasContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  canvasContext.beginPath();
}

function normalizeFlowerRecord(record) {
  return {
    id: record.id,
    imageUrl: record.image_url ?? record.imageUrl,
    createdAt: record.created_at ?? record.createdAt,
    x: Number(record.x),
    y: Number(record.y),
    size: Number(record.size),
    tilt: Number(record.tilt),
  };
}

// Outline of the mound's flat grassy top, in % of the garden image, traced from
// garden-mound-final.png (the green top only — not the cliff or the shadow).
// GARDEN_ASPECT converts height-% into width-% for distances.
const GARDEN_OUTLINE = [
  [97.1, 44.9], [95.4, 50.9], [92.6, 56.2], [88.8, 60.6], [85.2, 64.4], [80.9, 67.1],
  [77, 69.5], [73.3, 71.6], [69.4, 72.9], [66.1, 74.9], [62.3, 75.3], [58.7, 76.3],
  [55, 77.5], [51.1, 78.3], [46.8, 79], [42.5, 78.6], [38.1, 77.7], [33.5, 76.3],
  [29, 74], [25.1, 70.5], [23.3, 65.4], [22.2, 60.1], [17.8, 56.1], [12.4, 51.2],
  [7.8, 44.9], [5.9, 37.7], [7.7, 30.8], [11.3, 24.7], [15.7, 19.6], [20.9, 15.7],
  [26.4, 12.9], [31.4, 10.5], [36.3, 8.8], [41.1, 7.5], [46, 7.2], [50.5, 7.3],
  [55, 7.4], [59.3, 7.9], [63.5, 9.5], [67.6, 10.9], [71.7, 12.6], [76, 14.2],
  [80.3, 16.6], [84.8, 19.3], [88.7, 23.1], [92.1, 27.7], [95.1, 32.9], [96.9, 38.8],
];
const GARDEN_BOUNDS = {
  left: Math.min(...GARDEN_OUTLINE.map(([x]) => x)),
  right: Math.max(...GARDEN_OUTLINE.map(([x]) => x)),
  top: Math.min(...GARDEN_OUTLINE.map(([, y]) => y)),
  bottom: Math.max(...GARDEN_OUTLINE.map(([, y]) => y)),
};
const GARDEN_ASPECT = 1327 / 1186;
const GARDEN_EDGE_MARGIN = 1.5;
const FLOWER_GAP = 1.2;

function seededRandom(seedText) {
  let state = 0;
  for (const char of seedText) {
    state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard ray-casting point-in-polygon test.
function isInsideOutline(x, y) {
  let inside = false;
  for (let i = 0, j = GARDEN_OUTLINE.length - 1; i < GARDEN_OUTLINE.length; j = i++) {
    const [xi, yi] = GARDEN_OUTLINE[i];
    const [xj, yj] = GARDEN_OUTLINE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isOnGardenTop(x, y, halfSize) {
  const halfX = halfSize + GARDEN_EDGE_MARGIN;
  const halfY = (halfSize + GARDEN_EDGE_MARGIN) * GARDEN_ASPECT;
  const inside = (px, py) => isInsideOutline(px, py);

  // The base and sides must stay on the grass; the top may rise past the back edge.
  return (
    inside(x - halfX, y) &&
    inside(x + halfX, y) &&
    inside(x - halfX, y + halfY) &&
    inside(x + halfX, y + halfY) &&
    inside(x, y + halfY)
  );
}

// Places flowers oldest-first, each at the candidate spot farthest from the others,
// shrinking a flower a little if nothing is free. Seeding by id keeps the layout the
// same for every visitor, and a new flower never moves the ones before it.
function layoutGarden(flowers) {
  const placed = [];

  for (const flowerRecord of flowers) {
    const random = seededRandom(flowerRecord.id);
    // Stored sizes are 86–126px; show them as 8.8–12.1% of the garden's width.
    const baseSize = (8 + ((flowerRecord.size - 86) / 40) * 3) * 1.1;
    let best = null;

    for (let scale = 1; scale >= 0.6 && !(best?.clearance >= 0); scale -= 0.1) {
      const size = baseSize * scale;
      best = null;

      for (let attempt = 0; attempt < 300; attempt++) {
        const x = GARDEN_BOUNDS.left + random() * (GARDEN_BOUNDS.right - GARDEN_BOUNDS.left);
        const y = GARDEN_BOUNDS.top + random() * (GARDEN_BOUNDS.bottom - GARDEN_BOUNDS.top);

        if (!isOnGardenTop(x, y, size / 2)) {
          continue;
        }

        let clearance = Infinity;
        for (const other of placed) {
          const distance = Math.hypot(x - other.x, (y - other.y) / GARDEN_ASPECT);
          // 0.8: the drawing never fills its padded square; FLOWER_GAP keeps air between them.
          clearance = Math.min(
            clearance,
            distance - ((size + other.size) / 2) * 0.8 - FLOWER_GAP
          );
        }

        if (!best || clearance > best.clearance) {
          best = { x, y, size, clearance };
        }
      }
    }

    placed.push({ id: flowerRecord.id, ...(best ?? { x: 55, y: 42, size: baseSize }) });
  }

  return new Map(placed.map((spot) => [spot.id, spot]));
}

function renderVisibleGarden(flowers) {
  if (!plantedFlowersLayer) {
    return;
  }

  plantedFlowersLayer.replaceChildren();
  const spots = layoutGarden(flowers);

  for (const flowerRecord of flowers) {
    const flower = document.createElement("div");
    const flowerImage = document.createElement("img");
    const spot = spots.get(flowerRecord.id);
    const depth = 2 + Math.floor(spot.y / 7);

    flower.className = "planted-flower";
    flower.dataset.flowerId = flowerRecord.id;
    flower.style.left = `${spot.x}%`;
    flower.style.top = `${spot.y}%`;
    flower.style.zIndex = `${depth}`;
    flower.style.setProperty("--flower-size", `${spot.size}%`);
    flower.style.setProperty("--flower-tilt", `${flowerRecord.tilt}deg`);

    flowerImage.src = flowerRecord.imageUrl;
    flowerImage.alt = "Planted flower sketch";
    flowerImage.decoding = "async";
    flower.append(flowerImage);
    plantedFlowersLayer.append(flower);
  }
}

function renderGalleryStats(flowers) {
  if (!galleryStats) {
    return;
  }

  // Day 1 is the day the first flower was planted.
  const firstPlanted = Math.min(...flowers.map((flower) => new Date(flower.createdAt).getTime()));
  const day = flowers.length
    ? Math.floor((Date.now() - firstPlanted) / 86_400_000) + 1
    : 1;
  const count = `${flowers.length} flower${flowers.length === 1 ? "" : "s"} planted`;
  galleryStats.textContent = `Day ${day} · ${count}`;
}

// Just the drawings, newest first: no cards, numbers or dates.
function renderGallery(flowers) {
  renderGalleryStats(flowers);

  if (!galleryGrid) {
    return;
  }

  galleryGrid.replaceChildren();

  if (flowers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No flowers yet. Plant one to start the gallery.";
    galleryGrid.append(empty);
    return;
  }

  const orderedFlowers = [...flowers].sort(
    (left, right) => new Date(right.createdAt) - new Date(left.createdAt)
  );

  for (const flowerRecord of orderedFlowers) {
    const image = document.createElement("img");
    image.className = "gallery-flower-image";
    image.src = flowerRecord.imageUrl;
    image.alt = "Flower drawing";
    image.decoding = "async";
    image.loading = "lazy";
    galleryGrid.append(image);
  }
}

function setVisibleGardenFlowers(flowers) {
  visibleGardenFlowers = [...flowers]
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .slice(-MAX_VISIBLE_GARDEN_FLOWERS);
  renderVisibleGarden(visibleGardenFlowers);
}

function addFlowerToVisibleGarden(flowerRecord) {
  visibleGardenFlowers = [...visibleGardenFlowers, flowerRecord].slice(-MAX_VISIBLE_GARDEN_FLOWERS);
  renderVisibleGarden(visibleGardenFlowers);
}

function upsertFlowerIntoAllFlowers(flowerRecord) {
  const existingIndex = allFlowers.findIndex((entry) => entry.id === flowerRecord.id);

  if (existingIndex === -1) {
    allFlowers = [...allFlowers, flowerRecord];
  } else {
    const nextFlowers = [...allFlowers];
    nextFlowers[existingIndex] = flowerRecord;
    allFlowers = nextFlowers;
  }

  renderGallery(allFlowers);
}

function createLocalFlowerRecord(imageUrl) {
  // x/y are still stored, but on-screen positions come from layoutGarden.
  const x = 20 + Math.random() * 60;
  const y = 40 + Math.random() * 35;
  const flowerSize = 86 + Math.random() * 40;
  const flowerTilt = -14 + Math.random() * 28;

  return {
    id: crypto.randomUUID(),
    imageUrl,
    createdAt: new Date().toISOString(),
    x,
    y,
    size: flowerSize,
    tilt: flowerTilt,
  };
}

// folder is "pending" for the temporary copy the classifier looks at, "flowers" once accepted.
async function uploadFlowerImage(flowerRecord, folder = "flowers") {
  if (!supabaseClient) {
    return flowerRecord.imageUrl;
  }

  const imageBlob = dataUrlToBlob(flowerRecord.imageUrl);

  if (!imageBlob) {
    throw new Error("Could not convert the flower sketch into an upload.");
  }

  const filePath = `${folder}/${flowerRecord.id}.png`;
  const { error: uploadError } = await supabaseClient.storage
    .from(SUPABASE_FLOWERS_BUCKET)
    .upload(filePath, imageBlob, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabaseClient.storage.from(SUPABASE_FLOWERS_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

async function removePendingImage(flowerRecord) {
  if (!supabaseClient) {
    return;
  }

  const { error } = await supabaseClient.storage
    .from(SUPABASE_FLOWERS_BUCKET)
    .remove([`pending/${flowerRecord.id}.png`]);

  if (error) {
    console.warn("Could not remove the pending flower image.", error);
  }
}

async function insertFlowerRow(flowerRecord, imageUrl) {
  if (!supabaseClient) {
    return flowerRecord;
  }

  const payload = {
    id: flowerRecord.id,
    image_url: imageUrl,
    created_at: flowerRecord.createdAt,
    x: flowerRecord.x,
    y: flowerRecord.y,
    size: flowerRecord.size,
    tilt: flowerRecord.tilt,
  };

  const { data, error } = await supabaseClient
    .from("flowers")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFlowerRecord(data);
}

// On phones the garden sits above the canvas, out of view, so bring it back to show the new flower.
function showPlantedFlower() {
  const bounds = plantedFlowersLayer.getBoundingClientRect();
  const isFullyInView = bounds.top >= 0 && bounds.bottom <= window.innerHeight;

  if (!isFullyInView) {
    // scrollIntoView ignores this absolutely positioned layer in Chrome, so center it by hand.
    const centeredTop = window.scrollY + bounds.top - (window.innerHeight - bounds.height) / 2;
    window.scrollTo({
      top: Math.max(0, centeredTop),
      // "auto" would still be smooth: the page sets scroll-behavior: smooth.
      behavior: prefersReducedMotion.matches ? "instant" : "smooth",
    });
  }
}

async function plantFlowerPatch() {
  if (!plantedFlowersLayer || !hasCanvasDrawing() || isPlanting) {
    if (!hasCanvasDrawing()) {
      showPanelMessage("Draw a flower first");
    }

    return;
  }

  isPlanting = true;

  const flowerImageUrl = createFlowerImage();

  if (!flowerImageUrl) {
    isPlanting = false;
    return;
  }

  const localFlowerRecord = createLocalFlowerRecord(flowerImageUrl);

  clearCanvas();

  if (canvasStatus) {
    canvasStatus.textContent = "Checking your flower…";
  }

  try {
    // Nothing is kept until the classifier has looked at it. CLIP needs a public URL
    // (it reads data URLs as text), so it sees a temporary copy that's deleted right after.
    const pendingImageUrl = await uploadFlowerImage(localFlowerRecord, "pending");

    classifier?.queueSketchForClassification({
      imageUrl: pendingImageUrl,
      brushColor: activeBrushColor,
      plantedFlowerCount: allFlowers.length,
      flowerId: localFlowerRecord.id,
    });
    const job = await classifier?.classifyLatestSketch();
    const label = job ? job.result?.label : "unclassified";
    await removePendingImage(localFlowerRecord);

    if (label === "SECRET_GARDEN") {
      showPanelMessage("Hey! That's inappropriate");
      return;
    }

    if (label === "REJECT") {
      showPanelMessage("That's not a flower, silly");
      return;
    }

    if (label !== "ACCEPT" && label !== "unclassified") {
      showPanelMessage("Couldn't check that drawing, try again");
      return;
    }

    const uploadedImageUrl = await uploadFlowerImage(localFlowerRecord);
    const flowerRecord = { ...localFlowerRecord, imageUrl: uploadedImageUrl };
    const savedFlowerRecord = await insertFlowerRow(flowerRecord, uploadedImageUrl);
    const mergedFlowerRecord = {
      ...flowerRecord,
      ...savedFlowerRecord,
      imageUrl: uploadedImageUrl,
    };

    addFlowerToVisibleGarden(mergedFlowerRecord);
    upsertFlowerIntoAllFlowers(mergedFlowerRecord);

    if (canvasStatus) {
      canvasStatus.textContent = `Planted ${allFlowers.length} flower${allFlowers.length === 1 ? "" : "s"}`;
    }
    showPlantedFlower();
  } catch (error) {
    console.error("Failed to plant flower.", error);
    showPanelMessage("Couldn't plant that flower, try again");
  } finally {
    isPlanting = false;
  }
}

async function fetchRecentGardenFlowers() {
  if (!supabaseClient) {
    return [];
  }

  const { data, error } = await supabaseClient
    .from("flowers")
    .select("id, image_url, created_at, x, y, size, tilt")
    .eq("garden", "nice")
    .order("created_at", { ascending: false })
    .limit(RECENT_GARDEN_FLOWER_LIMIT);

  if (error) {
    throw error;
  }

  return data.map(normalizeFlowerRecord);
}

async function fetchAllFlowers() {
  if (!supabaseClient) {
    return [];
  }

  const { data, error } = await supabaseClient
    .from("flowers")
    .select("id, image_url, created_at, x, y, size, tilt")
    .eq("garden", "nice")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data.map(normalizeFlowerRecord);
}

async function loadInitialFlowers() {
  renderGallery(allFlowers);

  if (!supabaseClient) {
    if (canvasStatus) {
      canvasStatus.textContent = "Brush: Coral. Add Supabase keys to load the shared garden.";
    }

    return;
  }

  try {
    const [recentFlowers, galleryFlowers] = await Promise.all([
      fetchRecentGardenFlowers(),
      fetchAllFlowers(),
    ]);

    allFlowers = galleryFlowers;
    renderGallery(allFlowers);
    setVisibleGardenFlowers(recentFlowers);

    if (canvasStatus) {
      canvasStatus.textContent = `Brush: Coral. Loaded ${visibleGardenFlowers.length} recent flowers.`;
    }
  } catch (error) {
    console.error("Failed to load flowers from Supabase.", error);

    if (canvasStatus) {
      canvasStatus.textContent = "Brush: Coral. Could not load the shared garden.";
    }
  }
}

function getCanvasPoint(event) {
  const bounds = drawingCanvas.getBoundingClientRect();
  const deviceScale = window.devicePixelRatio || 1;
  const scaleX = bounds.width ? drawingCanvas.width / bounds.width / deviceScale : 1;
  const scaleY = bounds.height ? drawingCanvas.height / bounds.height / deviceScale : 1;

  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  };
}

function startDrawing(event) {
  if (!drawingCanvas || !canvasContext) {
    return;
  }

  isDrawing = true;
  drawingCanvas.setPointerCapture(event.pointerId);
  const point = getCanvasPoint(event);
  canvasContext.beginPath();
  canvasContext.moveTo(point.x, point.y);
}

function draw(event) {
  if (!isDrawing || !canvasContext) {
    return;
  }

  const point = getCanvasPoint(event);
  canvasContext.lineTo(point.x, point.y);
  canvasContext.stroke();
}

function stopDrawing(event) {
  if (!drawingCanvas || !canvasContext || !isDrawing) {
    return;
  }

  isDrawing = false;
  canvasContext.closePath();

  if (drawingCanvas.hasPointerCapture(event.pointerId)) {
    drawingCanvas.releasePointerCapture(event.pointerId);
  }
}

if (drawingCanvas && canvasContext) {
  resizeCanvas();

  drawingCanvas.addEventListener("pointerdown", startDrawing);
  drawingCanvas.addEventListener("pointermove", draw);
  drawingCanvas.addEventListener("pointerup", stopDrawing);
  drawingCanvas.addEventListener("pointerleave", stopDrawing);
  drawingCanvas.addEventListener("pointercancel", stopDrawing);

  window.addEventListener("resize", resizeCanvas);
}

loadInitialFlowers();

// The free classifier server sleeps when idle and takes a while to start, so nudge it awake
// as soon as the page opens; by the time someone presses Plant it's usually ready.
// It has no route here, so the reply is ignored; no-cors keeps the console quiet.
if (window.CLASSIFIER_API_URL) {
  fetch(window.CLASSIFIER_API_URL, { mode: "no-cors" }).catch(() => {});
}

if (typeof classifier?.subscribe === "function") {
  classifier.subscribe(({ eventName, detail: job }) => {
    if (eventName === "complete") {
      console.log("Classification:", job.result);
    }
    if (eventName === "failed") {
      console.warn("Classification failed for job", job.id, job.result?.errorMessage);
    }
  });
}

for (const swatch of swatches) {
  swatch.addEventListener("click", () => {
    const { color } = swatch.dataset;
    const label = swatch.getAttribute("aria-label") ?? "Color";

    if (!color) {
      return;
    }

    for (const button of swatches) {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    }

    swatch.classList.add("is-active");
    swatch.setAttribute("aria-pressed", "true");
    setBrushColor(color, label);
  });
}

resetCanvasButton?.addEventListener("click", () => {
  clearCanvas();
});

plantFlowerButton?.addEventListener("click", () => {
  plantFlowerPatch();
});

// Back's arrow: a little swirl at rest that unwinds into a long, slightly wobbly line on hover.
// Both shapes are the same four curves (start point + 4 × [control, control, end]), so every
// frame can blend them point by point; the arrowhead rides the tip along the last curve's direction.
const BACK_ARROW_SWIRL = [
  [218.6, 20.6], [215.2, 23.1], [210.1, 23.1], [208.4, 19.7], [206.7, 16.3], [210.1, 14.2], [212.7, 16.3],
  [214.8, 18.5], [211.8, 21.9], [207.6, 20.6], [203.3, 19.3], [201.6, 13.8], [197.4, 9.5],
];
const BACK_ARROW_STRETCHED = [
  [214, 16.5], [198.7, 17.4], [185.9, 15], [173.2, 15.8], [157.2, 16.8], [146.4, 17.2], [134.9, 15.6],
  [122.2, 14], [109.4, 17.2], [96.7, 16.4], [91.6, 16.1], [86.5, 16.4], [82, 16.3],
];
const BACK_ARROW_MS = 520;

function backArrowPath(amount) {
  const points = BACK_ARROW_SWIRL.map(([x, y], index) => {
    const [x2, y2] = BACK_ARROW_STRETCHED[index];
    return [x + (x2 - x) * amount, y + (y2 - y) * amount];
  });
  const [start, ...curves] = points;
  let d = `M${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
  for (let i = 0; i < curves.length; i += 3) {
    d += ` C${curves.slice(i, i + 3).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")}`;
  }

  const tip = points.at(-1);
  const control = points.at(-2);
  const angle = (Math.atan2(tip[1] - control[1], tip[0] - control[0]) * 180) / Math.PI + 180;
  const head = `translate(${tip[0].toFixed(1)} ${tip[1].toFixed(1)}) rotate(${angle.toFixed(1)}) scale(${0.5 + 0.5 * amount})`;
  return { d, head };
}

// Every Back pill (the nav's and the gallery's) gets its own swirl that unwinds on hover.
function setUpBackArrow(button) {
  const line = button.querySelector("[data-back-line]");
  const head = button.querySelector("[data-back-head]");
  if (!line || !head) {
    return;
  }

  let amount = 0;
  let frame = 0;

  const draw = (value) => {
    const shape = backArrowPath(value);
    line.setAttribute("d", shape.d);
    head.setAttribute("transform", shape.head);
  };

  const animateTo = (target) => {
    cancelAnimationFrame(frame);

    if (prefersReducedMotion.matches) {
      amount = target;
      draw(target);
      return;
    }

    const from = amount;
    const startTime = performance.now();
    const duration = BACK_ARROW_MS * Math.abs(target - from);

    const step = (now) => {
      const progress = duration ? Math.min(1, (now - startTime) / duration) : 1;
      amount = from + (target - from) * (1 - (1 - progress) ** 3);
      draw(amount);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
  };

  button.addEventListener("pointerenter", () => animateTo(1));
  button.addEventListener("pointerleave", () => animateTo(0));
  draw(0);
}

document.querySelectorAll(".nav-pill--back").forEach(setUpBackArrow);
