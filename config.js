window.GARDEN_SUPABASE_CONFIG = {
  url: "https://njafcckswgcxtvtqrjcn.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYWZjY2tzd2djeHR2dHFyamNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTg0MTIsImV4cCI6MjA5MDczNDQxMn0.Woc9DMhtSyhRnXS4pnOxUIYlP28wONWPYs_PaEBWSmI",
};

window.HUGGINGFACE_API_KEY = "hf_YourTokenHere";

// Pages opened from a local dev server use the local backend; the deployed site uses Render's.
// Check the backend URL in the Render dashboard: if the name was taken, Render adds a suffix.
const isLocalPage = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.CLASSIFIER_API_URL = isLocalPage
  ? "http://localhost:5000"
  : "https://garden-classifier-api.onrender.com";
