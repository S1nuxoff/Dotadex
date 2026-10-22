import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Each image marked once it has loaded (or failed), for pages that fade theirs in (.fade-images)
// instead of showing them the moment they arrive, after the page has come in
for (const type of ["load", "error"]) {
  document.addEventListener(type, (event) => event.target instanceof HTMLImageElement && event.target.setAttribute("data-loaded", ""), true);
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
