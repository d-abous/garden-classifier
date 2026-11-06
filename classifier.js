const GardenClassifier = (() => {
  const sketchQueue = [];
  const listeners = new Set();

  function emit(eventName, detail) {
    for (const listener of listeners) {
      listener({ eventName, detail });
    }
  }

  function queueSketchForClassification(sketch) {
    const job = {
      id: `sketch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      imageUrl: sketch.imageUrl,
      flowerId: sketch.flowerId,
      brushColor: sketch.brushColor,
      plantedFlowerCount: sketch.plantedFlowerCount,
      status: "queued",
      createdAt: new Date().toISOString(),
      result: null,
    };

    sketchQueue.push(job);
    emit("queued", job);
    return job;
  }

  function getQueuedSketches() {
    return [...sketchQueue];
  }

  function markSketchAsProcessing(jobId) {
    const job = sketchQueue.find((entry) => entry.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "processing";
    emit("processing", job);
    return job;
  }

  function completeSketchClassification(jobId, result) {
    const job = sketchQueue.find((entry) => entry.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "complete";
    job.result = result;
    emit("complete", job);
    return job;
  }

  function failSketchClassification(jobId, errorMessage) {
    const job = sketchQueue.find((entry) => entry.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "failed";
    job.result = { errorMessage };
    emit("failed", job);
    return job;
  }

  function subscribe(listener) {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  async function classifyLatestSketch() {
    const queuedJob = sketchQueue.find((entry) => entry.status === "queued");

    if (!queuedJob) {
      return null;
    }

    markSketchAsProcessing(queuedJob.id);

    const apiUrl = window.CLASSIFIER_API_URL;

    const hasPublicImageUrl = /^https?:\/\//.test(queuedJob.imageUrl ?? "");

    if (!apiUrl || apiUrl.includes("YOUR_CLASSIFIER") || !hasPublicImageUrl) {
      completeSketchClassification(queuedJob.id, {
        label: "unclassified",
        scores: { flower: 0, scribbles: 0, inappropriate: 0 },
      });
      return queuedJob;
    }

    try {
      const response = await fetch(`${apiUrl}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: queuedJob.imageUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? `HTTP ${response.status}`);
      }

      const result = await response.json();
      completeSketchClassification(queuedJob.id, result);
    } catch (error) {
      console.error("Classification failed:", error);
      failSketchClassification(queuedJob.id, error.message);
    }

    return queuedJob;
  }

  return {
    classifyLatestSketch,
    completeSketchClassification,
    failSketchClassification,
    getQueuedSketches,
    markSketchAsProcessing,
    queueSketchForClassification,
    subscribe,
  };
})();

window.GardenClassifier = GardenClassifier;
